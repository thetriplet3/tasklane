# Tasklane

A task board beside a long Claude session. It shows:

- **Tasks.** Each request becomes a card in one of four columns: Needs you, Running, Parked and Done. Follow-ups such as "go ahead" stay on the task in progress. A short title is written for each task, and the opening message shows when you hover a card.
- **Cost.** What the session cost, its token mix and the last 24 hours, plus the cost of each turn and each task.
- **Usage by agent.** The main chat and each subagent, with what each one cost.
- **Activity.** What Tasklane itself is doing: reading the transcript, totting up usage, naming tasks, with how long each took, and what its Haiku calls cost by purpose.
- **Rules** you want kept in view, and **connections** to other sessions you've messaged.

Open it with `/tasklane`. Every section folds away, and the chips at the top show one section at a time.

## Install

```
/plugin install tasklane --marketplace thetriplet3/tasklane
```

## Good to know

- On first open it reads this session's transcript, along with any subagent transcripts, from `~/.claude/projects` on your computer. Nothing is sent anywhere.
- After each turn it makes one short Haiku call to name the task in progress. On first open it also names up to 20 earlier tasks. Each call costs a fraction of a cent.
- "Go to message" works in the terminal only. The desktop app doesn't let a mod scroll the chat.
