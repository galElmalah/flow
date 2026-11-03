# Generate videos in a local workflow

Use **Video generation** to create clips through the public Gemini API. Flow saves each completed MP4 in the same project and run history as its inputs.

## Configure API access

Open **Settings → Connections** and configure **Gemini video API**. Choose an API key or Google Cloud application default credentials. An installed Gemini coding CLI does not authorize this API.

To configure from an agent, save the connection JSON in a private local file and run:

```sh
node cli/flow.mjs providers configure-video --from /absolute/path/private-video-connection.json
node cli/flow.mjs providers gemini-video --json
```

For API-key authentication, the private file contains:

```json
{ "authMode": "api-key", "apiKey": "YOUR_API_KEY" }
```

For Google Cloud application default credentials, use:

```json
{ "authMode": "oauth-adc", "quotaProject": "YOUR_CLOUD_PROJECT" }
```

Set up ADC through Google's supported Cloud authentication process before selecting it. Flow does not reuse the coding CLI's cached credentials. Omit `apiKey` to keep the stored key. Supply a string to replace it or `null` to clear it. Connection reads expose setup status and never return stored keys.

Gemini API usage uses Cloud/API billing. Flow's included subscription credits do not fund these requests. Eligible Google AI Pro accounts can activate separate Developer Program Cloud credits. Check your account's activation, billing requirements, and balance before generation. See [Google AI plans and API access](https://ai.google.dev/gemini-api/docs/google-ai-plans) and [Google's OAuth guide](https://ai.google.dev/gemini-api/docs/oauth).

## Create and plan a video workflow

In the canvas, add **Video generation** and connect a prompt or scene template. Connect an optional seed-image node when the selected model accepts image references. Connect the result to **Video collection**.

The CLI creates the same graph without starting inference:

```sh
node cli/flow.mjs workflow create \
  --project sports-agent-visuals \
  --id sports-motion-video-v1 \
  --name "Sports motion video" \
  --media video \
  --prompt "A cyclist accelerates across the frame. Monochrome, motion blur, film grain." \
  --ratio 16:9 --resolution 720p --count 1 --json

node cli/flow.mjs plan --project sports-agent-visuals --workflow sports-motion-video-v1 --json
```

The plan reports `videoJobs` separately from `imageJobs` and `textJobs`. Records and variations multiply copies as they do for image workflows. Review the count before running.

The default provider is `gemini-video` and the default model is `gemini-omni-1.1-flash`. Use the provider catalog for supported settings. A variation seed is a bookkeeping label unless the provider explicitly reports deterministic seed support. A duration written in the prompt does not guarantee an exact clip duration.

## Run and inspect a clip

```sh
node cli/flow.mjs run --project sports-agent-visuals --workflow sports-motion-video-v1 --wait --json
node cli/flow.mjs inspect RUN_ID --project sports-agent-visuals --json
node cli/flow.mjs open sports-motion-video-v1 --project sports-agent-visuals --run RUN_ID
node cli/flow.mjs download RUN_ID --project sports-agent-visuals --output clips.zip
```

Keep the returned run ID. Calling `run` again creates another generation request.

The node displays submission, remote rendering, and download stages. The run preserves the remote interaction receipt across refreshes and server restarts. A job-count percentage describes finished jobs, not the provider's render progress.

Open a completed clip to play it, inspect its prompt and image references, or download the MP4. Video collections are terminal. Video outputs cannot connect to image or prompt sockets, and they do not open the SAM image editor.

## Resume interrupted work

Use the existing run rather than submitting a new one:

```sh
node cli/flow.mjs resume RUN_ID --project sports-agent-visuals --json
node cli/flow.mjs wait RUN_ID --project sports-agent-visuals --json
```

If Flow saved an accepted interaction, resume polls that interaction. Cancelling local work may leave the remote generation running. If the submission outcome is unknown, reconcile the provider operation before creating another run. Flow does not silently resubmit an ambiguous paid request.

## Use the JavaScript client or MCP

The client exports `createVideoWorkflow()` next to `createImageWorkflow()`. Save the graph with `client.createWorkflow()`, then use the existing `plan()`, `run()`, `inspect()`, `wait()`, `gallery()`, and run-control methods. `geminiVideoConnection()` reads public setup status. `configureGeminiVideo()` accepts the same private connection JSON as the CLI.

MCP exposes `create_video_workflow`, `read_gemini_video_connection`, and `configure_gemini_video`. The existing workflow, run, gallery, download, and viewer tools handle video jobs. Creating or saving a workflow never starts generation. Workflow graphs, manifests, and exports must not contain authentication secrets.

See [the video-node design](design/video-node.md) for queue ownership and recovery behavior.
