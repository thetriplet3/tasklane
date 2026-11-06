# Tasklane

A task board beside a long Claude session. It shows:

- **Tasks.** Each request becomes a card in one of four columns: Needs you, Running, Parked and Done. Follow-ups such as "go ahead" stay on the task in progress. A short title is written for each task, and the opening message shows when you hover a card.
- **Cost.** What the session cost, its token mix and the last 24 hours, plus the cost of each turn and each task.
- **Usage by agent.** The main chat and each subagent, with what each one cost.
- **Activity.** What Tasklane itself is doing: reading the transcript, totting up usage, naming tasks, with how long each took, and what its Haiku calls cost by purpose.
- **Rules** you want kept in view, and **connections** to other sessions you've messaged.

Open it with `/tasklane`. Every section folds away, and the chips at the top show one section at a time.

## Requirements

**Python 3** has to be installed. Tasklane uses it to read the session's transcripts: earlier messages, usage by agent, and "Go to message". It tries `python3`, then `python`, then `py -3`, so a normal install works on macOS, Linux and Windows. Nothing else needs installing, because the readers use only Python's standard library.

Check with `python3 --version`, or `py -3 --version` on Windows. Without Python, the Activity section shows "No Python found", and those parts of the pane stay empty.

## Install

Tasklane is listed in the [Xenoviz marketplace](https://github.com/xenoviz/claude-plugins):

```
/plugin marketplace add xenoviz/claude-plugins
/plugin install tasklane@xenoviz
```

To update later, run `claude plugin marketplace update xenoviz` and `claude plugin update tasklane@xenoviz`, then restart Claude.

Installed it as `tasklane@tasklane` before? That listing is gone and won't update any more. Remove it with `claude plugin uninstall tasklane@tasklane` and `claude plugin marketplace remove tasklane`, then install it as above.

## Good to know

- On first open it reads this session's transcript, along with any subagent transcripts, from `~/.claude/projects` on your computer. Nothing is sent anywhere.
- After each turn it makes one short Haiku call to name the task in progress. On first open it also names up to 20 earlier tasks. Each call costs a fraction of a cent.
- "Go to message" works in the terminal only. The desktop app doesn't let a mod scroll the chat.
