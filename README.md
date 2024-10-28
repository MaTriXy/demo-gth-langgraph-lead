# LangGraph | gotoHuman

An AI agent [built with LangGraph](https://langchain-ai.github.io/langgraphjs/) integrating [gotoHuman](https://gotohuman.com) to keep a **human in the loop**.

[gotoHuman](https://gotohuman.com) is the easiest way to ask a human to review AI‑generated content, approve actions of AI agents or provide input.  
Simply create customized forms that your AI app can pass to your team whenever human review is needed.

This agent can be triggered with the email address of a new lead (from a waitlist, newsletter signup or lead magnet) to draft a personalized initial email outreach that is reviewed by a human before it is sent out.

## Set it up

### Create a form

This example uses our **"Sales Lead (Simple)"** template. Select it when [creating a new form](https://app.gotohuman.com/create). You will also enter a webhook that is called with the review response.

### Clone this agent

Clone this Next.js repo and set up your environment variables

```
OPENAI_API_KEY = sk-proj-XXX
GOTOHUMAN_API_KEY=XYZ
GOTOHUMAN_FORM_ID=abcdef123
POSTGRES_CONN_STRING="postgres://..."
```

### Run it

Send a request for human review [via API](https://docs.gotohuman.com/send-requests)

Simply call it whenever you get your hands on a new lead. gotoHuman will send a notification as soon as the agent is done with its' research, drafted an outreach message and needs approval.