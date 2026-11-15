# 90 Days Ready Plan Builder

A questionnaire that builds a custom 90-day preparedness plan and emails it. No human in the loop.

## How it works

1. A person answers four screens (household, home, needs, email).
2. `public/plan.js` builds the plan from fixed rules. No AI, no database. Same answers always give the same plan.
3. The plan shows on screen right away (print, save as PDF, or copy).
4. If they gave an email, the browser posts the answers to `netlify/functions/send-plan.js`. The function rebuilds the plan on the server and sends it through Resend.

Nothing is stored. The function does not log answers.

## Files

| File | Job |
| --- | --- |
| `public/index.html` | The questionnaire and the on-screen plan |
| `public/plan.js` | The rules. Shared by the page and the function |
| `netlify/functions/send-plan.js` | Sends the email |
| `netlify.toml` | Netlify settings |
| `test/plan.test.js` | Tests. Run `node test/plan.test.js` |

## Deploy (one time, about 20 minutes)

Drag-and-drop deploys do not include functions, so use Git or the CLI.

1. **Put this folder in a GitHub repo.**
2. **Netlify:** Add new site > Import an existing project > pick the repo. The build settings come from `netlify.toml`. Leave the build command empty.
3. **Resend (resend.com):** create an account, add and verify a domain you own (it gives you DNS records to add), then create an API key.
4. **Netlify > Site configuration > Environment variables**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `FROM_EMAIL` = `90 Days Ready <plan@yourdomain.com>` (must be on the verified domain)
5. In `public/index.html`, change `var EMAIL_ENABLED = false;` to `true`. This adds the email screen.
6. **Redeploy**, then fill out the form with your own email to test.

CLI alternative: `npm i -g netlify-cli`, then `netlify deploy --prod` from this folder.

The site ships with email switched off (`EMAIL_ENABLED = false`): three screens, then the plan on screen with print, PDF, and copy. Steps 3 to 5 turn email on.

## Before you share the link widely

- **Sender domain.** Resend will only send to other people from a domain you have verified. Check its current free-tier limits before a big push.
- **Abuse.** The function can only send this plan, so it is useless for spam content, but someone could still enter other people's addresses. There is a honeypot field for simple bots. For real traffic, add Netlify rate limiting or a CAPTCHA.
- **Review.** The self-defense, curfew, and medical lines are general. Have a lawyer and a clinician read `public/plan.js` before you promote this.
- **Privacy note.** The form asks about health needs. Keep the "not stored" promise true: do not add analytics that capture form values.

## Changing the plan

All wording and rules live in `buildPlan()` in `public/plan.js`. Add a question in `index.html`, add its allowed values to `ENUMS`, read it in `validate()`, and use it in `buildPlan()`. Run the tests after any change.
