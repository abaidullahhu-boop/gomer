Phase 1 — Foundation & Auth
Goal: Project runs locally, users can register/login, 
      database is set up, basic structure is solid.

Deliverable: NestJS server running, React frontend 
             with auth pages, PostgreSQL connected.

Phase 2 — Slack Bot & Workspace Setup
Goal: Slack app installed to a workspace, Gomer bot 
      responds to DMs and @mentions.

Deliverable: User installs Gomer to their Slack, 
             bot says hello, workspace is created 
             in your database.

Phase 3 — Pipedream Connect (Integrations)
Goal: Users can connect their apps (Gmail, Slack, 
      Google Ads etc) via OAuth through your app.

Deliverable: Integrations page works, user connects 
             Gmail, token stored via Pipedream Connect,
             NestJS can call Gmail actions on their behalf.

Phase 4 — AI Orchestration
Goal: Gomer can answer questions using connected 
      apps. User asks "check my Gmail" and gets 
      a real answer.

Deliverable: NestJS calls Claude with workspace 
             context, Claude decides which Pipedream 
             action to call, result posted to Slack.

Phase 5 — Skills System
Goal: Skills library works. Users can browse, 
      install and uninstall skills. Installed skills 
      inject into AI context automatically.

Deliverable: Skills page, seed data with 5-10 
             example skills, AI uses installed 
             skills when relevant.

Phase 6 — Scheduled Tasks
Goal: Autonomous Gomer. Cron jobs run, Gomer 
      proactively posts to Slack without being asked.

Deliverable: BullMQ running, 4 default tasks 
             auto-created on workspace install, 
             user can create custom tasks via chat.

Phase 7 — Settings
Goal: All settings work. Workspace instructions, 
      model selection, access control, team 
      permissions.

Deliverable: Settings page fully functional, 
             AI respects workspace instructions 
             and selected model.

Phase 8 — Usage & Credits
Goal: Every AI call is tracked and billed in credits. 
      Usage dashboard shows real data.

Deliverable: Credit system live, all 4 usage tabs 
             working with real data, burn rate 
             calculated.

Phase 9 — Polish & Launch Prep
Goal: Everything connected end-to-end, no broken 
      flows, ready for first real user.

Deliverable: Bug fixes, error handling, loading 
             states, deployment to Railway/Render, 
             environment variables configured.
