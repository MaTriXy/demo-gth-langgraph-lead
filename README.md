# LangGraph | gotoHuman

An AI agent [built with LangGraph](https://langchain-ai.github.io/langgraphjs/) integrating [gotoHuman](https://gotohuman.com) to keep a **human in the loop**.

[gotoHuman](https://gotohuman.com) is the easiest way to ask a human to review AI‑generated content, approve actions of AI agents or provide input.  
Simply create customized forms that your AI app can pass to your team whenever human review is needed.

This agent can be triggered with the email address of a new lead (from a waitlist, newsletter signup or lead magnet) to draft a personalized initial email outreach that is reviewed by a human before it is sent out.

## Set it up

### Create a form

This example uses our **"Sales Lead (Simple)"** template. Select it when [creating a new form](https://app.gotohuman.com/create). For the webhook, enter the URL where you deploy this app. It is called for each review response.

### Deploy this agent

Clone this Next.js repo, deploy it (e.g. to Vercel) and set up your environment variables

```
OPENAI_API_KEY = sk-proj-XXX
GOTOHUMAN_API_KEY=XYZ
GOTOHUMAN_FORM_ID=abcdef123
POSTGRES_CONN_STRING="postgres://..."
```

It uses our JS/TS SDK to [send requests](https://docs.gotohuman.com/send-requests) for human review.

### Run it

Trigger your agent whenever you get your hands on a new lead:

`HTTP POST [DEPLOY_URL]/api/agent`
```json
{
  "email": "new.lead@email.com"
}
```

Find a new request for review in your gotoHuman inbox as soon as the agent is done with its' research, drafted an outreach message and needs approval.