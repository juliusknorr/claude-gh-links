# gh-links

A Claude Code plugin that keeps a pane beside the chat with clickable links to every GitHub pull request and issue that shows up in tool output during the session, e.g. from `gh pr create`. Each entry shows its state (draft, ready, merged or closed for PRs, open or closed for issues), and for open PRs the review decision (approved, changes, review) and CI status (✓, ✗, …). Everything refreshes on load, at the end of every turn and every 5 minutes with one batched `gh api graphql` call, so the GitHub CLI must be installed and signed in.

The pane is 30 columns wide and opens by itself on the first link (from 144 terminal columns). `/gh-links` opens it at any width and refreshes the states.

## Install

At the prompt of a terminal session:

```
/plugin install gh-links --marketplace juliusknorr/claude-gh-links
```

From a shell:

```
claude plugin install gh-links --marketplace juliusknorr/claude-gh-links
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `juliusknorr/claude-gh-links`, then Add plugin.

## Development

```
claude plugin validate .
claude plugin test .
```
