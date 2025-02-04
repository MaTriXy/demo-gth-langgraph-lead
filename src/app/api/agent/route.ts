export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, Command, interrupt } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { GotoHuman } from "gotohuman";

const gotoHuman = new GotoHuman()

export async function POST(request: Request) {
  const req = await request.json()
  const threadId = req.meta?.threadId || (new Date()).getTime() // dummy random number
  console.log("POST received with meta ", req.meta)

  const StateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
    emailAddress: Annotation<string>,
    leadWebsiteUrl: Annotation<string>,
    emailToSend: Annotation<string>,
  })
  
  // Define the tools for the agent to use
  const webScrapeTool = tool(async ({ url }) => {
    const loader = new CheerioWebBaseLoader(url);
    const docs = await loader.load();
    return docs.length ? (docs[0]?.pageContent || "") : "";
  }, {
    name: "scraper",
    description:
      "Call to scrape a website.",
    schema: z.object({
      url: z.string().describe("The website URL to scrape."),
    }),
  });

  const summarizerTool = tool(async ({ content }) => {
    const messages = [
      new SystemMessage("You are a helpful website content summarizer. You will be passed the content of a scraped company website. Please summarize it in 250-300 words focusing on what kind of company this is, the services they offer and how they operate."),
      new HumanMessage(content),
    ];
    const model = new ChatOpenAI({ temperature: 0.5, model: "gpt-4o-mini" })
    const response = await model.invoke(messages);
    return response.content
  }, {
    name: "summarizer",
    description:
      "Call to summarize scraped website content.",
    schema: z.object({
      content: z.string().describe("The scraped website content that you want a summary of."),
    }),
  });
  
  const draftTool = tool(async ({ emailAddress, companyDescription}) => {
    const noDomain = !(companyDescription||"").length
  
    const senderName = "Jess"
    const senderCompanyDesc = "FreshFruits is a premier subscription-based delivery service dedicated to filling company offices with a daily supply of fresh fruits and light, wholesome meals. Our mission is to enhance workplace wellness and productivity by providing nourishing, convenient food solutions that promote healthy eating habits. In addition to our daily deliveries, we offer exceptional catering services for business meetings, ensuring your team is fueled and focused for every important discussion. Committed to quality and freshness, FreshFruits sources only the finest ingredients from trusted local farmers and suppliers."
    
    const messages = [
      new SystemMessage(`You are a helpful sales expert, great at writing enticing emails.
      You will write an email for ${senderName} who wants to reach out to a new prospect who left their email address: ${emailAddress} . ${senderName} works for the following company:
      ${senderCompanyDesc}
      Write no more than 300 words.
      ${!noDomain ? 'It must be tailored as much as possible to the prospect\'s company based on the website information we fetched. Don\'t mention that we got the information from the website. Include no placeholders! Your response should be nothing but the pure email body!' : ''}`),
      new HumanMessage((noDomain ? `No additional information found about the prospect` : `#Company website summary:
      ${companyDescription}`)),
    ];
    const model = new ChatOpenAI({ temperature: 0.75, model: "gpt-4o-mini" })
    const response = await model.invoke(messages);
    return response.content
  }, {
    name: "email-drafter",
    description:
      "Call to draft a sales email.",
    schema: z.object({
      emailAddress: z.string().describe("The email address of the new lead that we want to reach out to."),
      companyDescription: z.string().describe("A description of the company based on the content found on its website."),
    }),
  });
  
  const tools = [webScrapeTool, summarizerTool, draftTool];
  const toolNode = new ToolNode(tools);
  
  const model = new ChatOpenAI({ temperature: 0.25, model: "gpt-4o-mini" }).bindTools(tools);
  
  // Define the function that determines whether to continue or not
  async function determineNextNode(state: typeof StateAnnotation.State): Promise<"tools" | "askHuman"> {
    const lastMessage = state.messages[state.messages.length - 1];
    const castLastMessage = lastMessage as AIMessage;
    // If there are no tool calls, then we go to next node for human approval
    if (castLastMessage && !castLastMessage.tool_calls?.length) {
      return "askHuman";
    }
    // Otherwise, we process the tool call
    return "tools";
  }
  
  // Define the function that calls the model
  async function callModel(state: typeof StateAnnotation.State) {
    const messages = state.messages;
    console.log("callModel ", messages[messages.length - 1])
    const response = await model.invoke(messages);
  
    // We return a list, because this will get added to the existing list
    return { messages: [response] };
  }

  async function extractDomainNode(state: typeof StateAnnotation.State) {
    const url = extractDomain(state.emailAddress)
    console.log("extractDomainNode " + url)
    return { leadWebsiteUrl: url, messages: [new HumanMessage(`We got the email address of a new lead: ${state.emailAddress}. ${url ? (`Scrape the website of its' domain: ${url} . Then use the summarizer tool to describe it.`) : ""} Then write an outreach email.`)] }
  }

  function humanReviewNode(state: typeof StateAnnotation.State): Command {
    const emailDraft = state?.messages?.length ? state.messages[state.messages.length - 1].content : ""
    const result = interrupt({
      emailDraft: emailDraft,
    });
    const { response, reviewedEmail, comment } = result;
  
    if (response === "retry") {
      return new Command({ goto: "agent", update: { messages: [{role: "human", content: "Please regenerate the email draft and consider the following: " + comment}] } });
    } else if (response === "approve") {
      return new Command({ goto: "sendEmail", update: { emailToSend: reviewedEmail } });
    }
    return new Command({ goto: END });
  }

  function sendEmailNode(state: typeof StateAnnotation.State) {
    console.log("sending email to " + state.emailAddress, state.emailToSend.slice(0,50))
    // TODO: implement email sending.
    return {};
  };
  
  // Define a new graph
  const workflow = new StateGraph(StateAnnotation)
    .addNode("domainStep", extractDomainNode)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("askHuman", humanReviewNode, {ends:["agent", "sendEmail", END]})
    .addNode("sendEmail", sendEmailNode)
    .addEdge(START, "domainStep")
    .addEdge("domainStep", "agent")
    .addConditionalEdges("agent", determineNextNode, ["askHuman", "tools"])
    .addEdge("tools", "agent")
    .addEdge("sendEmail", END);
  
  // Initialize DB to persist state of the conversation thread between graph runs
  const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_CONN_STRING!);
  if (!req.meta?.threadId) //if this is already a response from gotoHuman we don't need to setup again
    await checkpointer.setup();
  
  const graph = workflow.compile({ checkpointer });
  const config = { configurable: { thread_id: threadId } }

  if (req.type === 'review') {
    // we were called again with the review response from gotoHuman

    const approval = req.responseValues.emailApproval?.value
    const emailText = req.responseValues.emailDraft?.value;
    const retryComment = req.responseValues.retryComment?.value;
    console.log(`GTH approval ${approval} emailText ${emailText.slice(0,50)} retryComment ${retryComment}`)

    await graph.invoke(new Command({ resume: { response: approval, reviewedEmail: emailText, comment: retryComment } }), config);
  } else if (req.type === 'trigger' || req.email) {
    // we were called by the gotoHuman trigger or by another request including an email
    const email = req.email || req.responseValues?.email?.value || "";

    const inputs = { emailAddress: email };
    await graph.invoke(inputs, config);
  }

  const state = await graph.getState(config);
  if (state.next.length > 0 && state.next[0] === "askHuman") {
    const dataFromInterrupt = state.tasks?.[0]?.interrupts?.[0]?.value
    const reviewRequest = gotoHuman.createReview(process.env.GOTOHUMAN_FORM_ID)
      .addFieldData("email", state.values?.emailAddress || "")
      .addFieldData("emailDomain", {url: state.values?.leadWebsiteUrl || "", label: "Website checked"})
      .addFieldData("emailDraft", dataFromInterrupt?.emailDraft)
      .addMetaData("threadId", threadId)
      // .assignToUsers(["jess@acme.org"])
    const gotoHumanResponse = await reviewRequest.sendRequest()
    console.log("gotoHumanResponse", gotoHumanResponse)
    return Response.json({message: "The email draft needs human review.", link: gotoHumanResponse.gthLink}, {status: 200})
  }
  console.log("graph ended")
  return Response.json({message: "Graph ended"}, {status: 200})
}

function extractDomain(email: string) {
  const domain = email.split('@').pop();
  if (!domain) return null;
  const regex = createDomainRegex();
  return (!regex.test(domain)) ? `https://${domain}` : null
}

const commonProviders = [
  'gmail', 'yahoo', 'ymail', 'rocketmail',
  'outlook', 'hotmail', 'live', 'msn',
  'icloud', 'me', 'mac', 'aol',
  'zoho', 'protonmail', 'mail', 'gmx'
];

function createDomainRegex() {
  // Escape any special regex characters in the domain names
  const escapedDomains = commonProviders.map(domain => domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Join the domains with the alternation operator (|)
  const pattern = `(^|\\.)(${escapedDomains.join('|')})(\\.|$)`;
  return new RegExp(pattern);
}