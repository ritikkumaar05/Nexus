# Nexus

Nexus is an AI-powered collaborative workspace for students to organize notes, manage tasks, collaborate with teammates, and accelerate learning.

## Features

- Authentication and authorization with JWT access tokens and refresh sessions
- Collaborative documents with real-time editing support
- Workspace, member, channel, and invite management
- Real-time chat and document discussion threads
- Task management and study material organization
- AI-powered summaries, quizzes, flashcards, explanations, and important questions
- Email verification and password reset flows
- File attachments, search, audit trails, and permission checks

## Tech Stack

- Frontend: JavaScript, HTML, CSS, Vite, Socket.IO Client, Yjs
- Backend: Node.js, Express, MongoDB, Mongoose, Socket.IO, Yjs
- Security: Helmet, CORS controls, rate limiting, bcrypt, JWT
- Development: Git, npm, Node test runner

## Project Structure

```text
Nexus/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── test/
├── frontend/
│   ├── features/
│   ├── services/
│   ├── state/
│   └── styles/
├── package.json
└── README.md
```

## Getting Started

Clone the repository:

```bash
git clone git@github.com:ritikkumaar05/Nexus.git
cd Nexus
```

Install backend dependencies:

```bash
cd backend
npm install
```

Install frontend dependencies:

```bash
cd ../frontend
npm install
```

## Environment Variables

Real `.env` files are ignored by git. Use the example files as templates and keep real secrets only in local or deployment environment variables.

Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

Important backend variables:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/collab-workspace
JWT_SECRET=replace_with_a_long_random_secret
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
FRONTEND_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:5000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
EMAIL_PROVIDER_URL=
EMAIL_PROVIDER_API_KEY=
GEMINI_API_KEY=
```

Create the frontend env file:

```bash
cp frontend/.env.example frontend/.env
```

Frontend variables:

```env
VITE_API_BASE=http://localhost:5000
```

For production, set strong real values for `JWT_SECRET`, `MONGO_URI`, `CORS_ORIGIN`, `FRONTEND_ORIGIN`, `API_BASE_URL`, Google OAuth, email provider, and any AI provider keys.

## Running Locally

Start the backend:

```bash
cd backend
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

The frontend runs at `http://127.0.0.1:5173` and the backend defaults to `http://localhost:5000`.

## Testing

Run backend tests:

```bash
cd backend
npm test
```

Build the frontend:

```bash
cd frontend
npm run build
```

## Security Notes

- Do not commit `.env`, `.env.local`, `.env.production`, or any other real environment file.
- Commit only `.env.example` files with placeholders or safe local defaults.
- Rotate any API key, OAuth secret, database URL, or JWT secret that was ever committed or shared.
- Use HTTPS origins and long random secrets in production.

## Current Status

Nexus is under active development. New features, performance improvements, and UI enhancements are being added continuously.

## Author

Ritik Kumar  
GitHub: <https://github.com/ritikkumaar05>
