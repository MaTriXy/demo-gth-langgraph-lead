# LangGraph | gotoHuman

An AI agent [built with LangGraph](https://langchain-ai.github.io/langgraphjs/) integrating [gotoHuman](https://gotohuman.com) to keep a **human in the loop**.

[gotoHuman](https://gotohuman.com) helps you build production-ready AI workflows by making it really easy to include human approvals. Keep a human in the loop to review AI‑generated content, approve critical actions or provide input.  
Set up a fully customized review step capturing any relevant data (text, images, markdown,...) and required human input (buttons, checkboxes, inputs,...). Then trigger it from your application whenever human review from your team is needed.

This example workflow uses our JS/TS SDK to [send requests](https://docs.gotohuman.com/send-requests) for human review.

Trigger it with the email address of a new lead (from a waitlist, newsletter signup or lead magnet) to draft a personalized initial email outreach that is reviewed by a human before it is sent out.

## Set it up

### Create a review form

This example uses our **"Sales Lead (Simple)"** template which contains just the right fields for our use case. Select it when [creating a new review form](https://app.gotohuman.com/create). For the webhook, enter the URL where you deploy this app. It is called for each review response to continue the workflow.  
Reviewers will find new pending reviews in their [gotoHuman inbox](https://app.gotohuman.com). You can also opt-in to receive a short-lived public link that you can freely send to reviewers.

### Deploy this agent

Clone this Next.js repo, deploy it (e.g. to Vercel) and set up your environment variables

```
OPENAI_API_KEY = sk-proj-XXX
GOTOHUMAN_API_KEY=XYZ
GOTOHUMAN_FORM_ID=abcdef123
POSTGRES_CONN_STRING="postgres://..."
```

### Run it

Trigger your agent whenever you get your hands on a new lead:

`HTTP POST [DEPLOY_URL]/api/agent`
```json
{
  "email": "new.lead@email.com"
}
```

Find a new request for review in your gotoHuman inbox as soon as the agent is done with its' research, drafted an outreach message and needs approval.

![gotoHuman - Human approval for AI lead outreach](./img/docs-lead-example-review.jpg)