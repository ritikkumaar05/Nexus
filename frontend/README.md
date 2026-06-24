# Workspace Vertical Slice

Static frontend for the backend vertical slice:

- auth
- workspace selection
- channel creation
- REST chat
- document creation/edit/save
- AI document action

Run it from this directory with:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

The frontend expects the backend at `http://localhost:5000`.

The document editor uses Socket.IO and Yjs for live updates, persisted document
state, presence, cursor positions, and reconnect recovery.
