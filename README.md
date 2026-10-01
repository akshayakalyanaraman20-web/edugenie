# EduGenie

A focused learning studio powered by Google Gemini. Ask a question, pick a learning style, and work through ideas with a patient tutor.

## Run locally

Requires Node.js 20.6 or newer and a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

Copy `.env.example` to `.env`, add your API key, then start the app:

```sh
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API key stays on the server and is never sent to the browser. Prompts are sent to Google Gemini to generate replies; session history is held in browser memory and is not saved. Set `GEMINI_MODEL` or `PORT` in the environment to use another Gemini model or port. No database or third-party packages are required.

Choose **Explain** for a clear lesson, **Explore** to reason through an idea together, or **Quiz** for one question at a time. Sessions remain in browser memory and are not saved.

## Troubleshooting Gemini

Use **Test Gemini** in the header to check the configured key and model with a short test request. If the key is missing or still the example placeholder, copy `.env.example` to `.env`, replace `GEMINI_API_KEY` with a key from Google AI Studio, and restart the server. For permission errors, check that the Generative Language API is enabled for the key's project and allowed by its API restrictions. For quota errors, review the project's Gemini API usage and limits. If the configured model is unavailable, set `GEMINI_MODEL` in `.env` to a model that supports `generateContent`.
