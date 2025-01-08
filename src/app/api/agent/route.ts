export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END } from "@langchain/langgraph";
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
    leadWebsiteUrl: Annotation<string>,
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
      ${!noDomain ? 'It must be tailored as much as possible to the prospect\'s company based on the website information we fetched. Don\'t mention that we got the information from the website.' : ''}`),
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const askHumanTool = tool((_) => {
    return "The human response will be injected";
  }, {
    name: "askHuman",
    description: "Ask the human for review.",
    schema: z.object({
      emailAddress: z.string().describe("The email address of the new lead."),
      websiteUrl: z.string().describe("The website url derived from the lead email address."),
      companyDescription: z.string().describe("A description of the company based on the content found on its website."),
      emailDraft: z.string().describe("A draft for a sales email that needs human review."),
    }),
  });

  const sendEmailTool = tool(({emailRecipient, emailBody}) => {
    // TODO: implement email sending.
    // Again, note that you can set up your form at gotoHuman with any webhook URL, so that a submitted review can trigger any HTTP endpoint you like to proceed your workflow. It doesn't have to go back to this app.
    return `The email was sent to ${emailRecipient}: ${emailBody.slice(0,50)}`;
  }, {
    name: "sendEmail",
    description: "Send an email.",
    schema: z.object({
      emailRecipient: z.string().describe("The email address to send to."),
      emailBody: z.string().describe("The email body to send."),
    }),
  });
  
  const tools = [webScrapeTool, summarizerTool, draftTool, sendEmailTool];
  const toolNode = new ToolNode(tools);
  
  const model = new ChatOpenAI({ temperature: 0.25, model: "gpt-4o-mini" }).bindTools([...tools, askHumanTool]);
  
  // Define the function that determines whether to continue or not
  // We can extract the state typing via `StateAnnotation.State`
  async function shouldContinue(state: typeof StateAnnotation.State): Promise<"tools" | "askHuman" | typeof END> {
    const lastMessage = state.messages[state.messages.length - 1];
    const castLastMessage = lastMessage as AIMessage;
    // If there is no function call, then we finish
    if (castLastMessage && !castLastMessage.tool_calls?.length) {
      return END;
    }
    console.log("shouldContinue toolCall", castLastMessage.tool_calls?.[0])
    // If tool call is askHuman, we return that node
    // Send a review request to gotoHuman
    if (castLastMessage.tool_calls?.[0]?.name === "askHuman") {
      console.log("--- ASKING HUMAN ---")
      const args = castLastMessage.tool_calls?.[0]?.args
      const reviewRequest = gotoHuman.createReview(process.env.GOTOHUMAN_FORM_ID)
        .addFieldData("email", args?.emailAddress)
        .addFieldData("emailDomain", {url: args?.websiteUrl || "", label: "Website checked"})
        .addFieldData("websiteSummary", args?.companyDescription)
        .addFieldData("emailDraft", args?.emailDraft)
        .addMetaData("threadId", threadId)
        // .assignToUsers(["jess@acme.org"])
      const gotoHumanResponse = await reviewRequest.sendRequest()
      console.log("gotoHumanResponse", gotoHumanResponse)
      return "askHuman";
    }
    // Otherwise if it isn't, we continue with the action node
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

  async function extractDomainStep() {
    const url = extractDomain(req.email)
    console.log("extractDomainStep " + url)
    return { leadWebsiteUrl: url, messages: [new HumanMessage(`We got the email address of a new lead: ${req.email}. ${url ? (`Scrape the website of its' domain: ${url} . Then use the summarizer tool to describe it.`) : ""} Then write an outreach email and finally pass all information and the draft to a human to review it. If the reviewer accepts it, send the email. Note that the reviewer might have edited it.`)] }
  }

  // We define a fake node to ask the human
  function askHuman(state: typeof StateAnnotation.State): Partial<typeof StateAnnotation.State> {
    return state;
  }
  
  // Define a new graph
  const workflow = new StateGraph(StateAnnotation)
    .addNode("domainStep", extractDomainStep)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("askHuman", askHuman)
    .addEdge(START, "domainStep")
    .addEdge("domainStep", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("askHuman", "agent");
  
  // Initialize DB to persist state of the conversation thread between graph runs
  const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_CONN_STRING!);
  if (!req.meta?.threadId) //if this is already a response we don't need to setup again
    await checkpointer.setup();
  
  // Finally, we compile it!
  // This compiles it into a LangChain Runnable.
  // Note that we're (optionally) passing the memory when compiling the graph
  const app = workflow.compile({ checkpointer, interruptBefore: ["askHuman"] });
  const appConfig = { configurable: { thread_id: threadId } }

  // we were called again with the review response from gotoHuman
  // NOTE: You can set up your form at gotoHuman with any webhook URL, so that a submitted review can trigger any HTTP endpoint you like to proceed your workflow. It doesn't have to go back to this app.
  if (req.responseValues) {
    const accepted = req.responseValues.emailApproval?.value === 'approve'
    const emailText = req.responseValues.emailDraft?.value;
    const emailTextChanged = req.responseValues.emailDraft?.wasEdited;
    console.log(`GTH accepted ${accepted} emailTextChanged ${emailTextChanged} emailText ${emailText.slice(0,50)}`)
    const currentState = await app.getState(appConfig);
    const currentMessages = currentState?.values?.messages
    console.log("currentState.values.messages", currentMessages)
    if (!currentMessages) return new Response("Couldn't load persisted thread with ID " + req.meta?.threadId, { status: 404 })
    const askHumanToolCallId = currentState.values.messages[currentState.values.messages.length - 1].tool_calls[0].id;

    // We now create the tool call with the id and the response we want
    const toolMessage = new ToolMessage({
      tool_call_id: askHumanToolCallId,
      content: `The human supervisor ${accepted ? 'accepted' : 'rejected'} the drafted email. ${accepted && emailTextChanged ? `The text was edited, so please send this edited text instead: ${emailText}` : ''}`
    });
    // We now update the state
    // Notice that we are also specifying `asNode: "askHuman"`
    // This will apply this update as this node,
    // which will make it so that afterwards it continues as normal
    await app.updateState(appConfig, { messages: [toolMessage] }, "askHuman");
    
    console.log("--- State after update ---")
    console.log(await app.getState(appConfig));
  }

  // Use the Runnable
  const finalState = await app.invoke(req.responseValues ? null : {}, appConfig);
  const finalMsg = finalState?.messages?.length ? finalState.messages[finalState.messages.length - 1] : ""
  console.log(finalMsg.content);
  return Response.json({"answer": finalMsg.content, "domain": finalState.leadWebsiteUrl})
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