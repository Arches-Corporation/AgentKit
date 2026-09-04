# Skill: attach-pr-recording

Attach a Playwright e2e recording to a GitHub PR — headless (no browser drag-drop).
Trigger: "attach video to PR", "upload the recording to PR", "put the e2e video on PR".

## Steps

1. Ensure a recording exists at `apps/web/e2e/test-results/**/video.webm` — run the
   `e2e-testing` skill first if not.
2. From `apps/web/e2e`, run the uploader:
   ```bash
   npm run upload:recording -- <PR> [video] [--comment]
   ```
   - `<PR>` — omit to auto-detect the open PR for the current branch.
   - `[video]` — a path/slug; omit to use the newest recording.
   - `--comment` — post a PR comment instead of editing the description (default: description).
3. It converts the video to mp4, uploads it as an asset on the shared `e2e-artifacts`
   GitHub Release, then links it from the PR (idempotent marker block in the body).

## Notes

- Result is a clickable **link, not an inline player**: GitHub only auto-embeds videos on
  its browser-only `user-attachments` host, which has no API.
- Requires `gh` (authenticated as the Arches account) + `ffmpeg`.
- Do NOT auto-run from `npm test`; invoke explicitly.

## Output

Report the asset URL and whether it landed in the PR description or as a comment.
