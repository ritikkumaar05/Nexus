const DEMO_WORKSPACE_ID = 'demo-workspace-cs-final-year';
const DEMO_DOC_CONTENT = {
  'demo-doc-ds-lecture': `Distributed Systems - Lecture Notes

CAP Theorem
The CAP theorem states that a distributed system can only guarantee two out of three: consistency, availability, and partition tolerance.

Key insight:
In real systems, network partitions are unavoidable, so teams usually choose between CP and AP design.

Consensus Algorithms
Paxos and Raft help a collection of machines agree on one value even when some machines fail. Raft is easier to understand because it separates leader election, log replication, and safety.`,
  'demo-doc-ds-problems': `Distributed Systems - Problem Sets

1. Explain why partition tolerance is unavoidable in distributed systems.
2. Compare CP and AP system designs with examples.
3. Trace the prepare and accept phases in Paxos.
4. Design a simple key-value store and explain its consistency tradeoffs.`,
  'demo-doc-ds-exam': `Distributed Systems - Exam Prep

High-priority topics:
- CAP theorem
- Paxos prepare phase
- Raft leader election
- Replication logs
- Fault tolerance

Remember: exam answers should explain tradeoffs, not just definitions.`,
  'demo-doc-ml-guide': `ML Study Guide

Model evaluation tells us whether a machine learning model generalizes beyond training data.

Important metrics:
- Accuracy
- Precision
- Recall
- F1 score
- ROC-AUC

For imbalanced datasets, accuracy can be misleading. Prefer precision, recall, and F1 depending on the cost of false positives and false negatives.`,
  'demo-doc-ml-eval': `Model Evaluation Notes

Validation split: used during model selection.
Test split: used once at the end.

Cross-validation reduces variance in evaluation by training and testing across multiple folds.

Confusion matrix:
TP = predicted positive and actually positive.
FP = predicted positive but actually negative.
FN = predicted negative but actually positive.`,
  'demo-doc-project-plan': `Final Year Project Plan

Project: Nexus collaborative learning workspace.

Goals:
- Real-time document collaboration
- Document-scoped tasks
- Discussion threads beside notes
- AI summaries and quizzes
- Workspace member management

Milestone this week: polish demo workspace and onboarding flow.`,
  'demo-doc-meeting-notes': `Meeting Notes

Attendees: Alex, Priya, Rohan, Sam

Decisions:
- Keep Nexus document-first.
- Right panel should contain AI, Tasks, Discussion, and Members.
- Demo mode should feel alive without requiring signup.

Next actions:
- Priya: prepare ML quiz prompts.
- Rohan: review Paxos notes.
- Sam: polish project proposal.`
};

const DEMO_AI_OUTPUTS = {
  summarize: `Short Summary:
The CAP theorem says a distributed system cannot perfectly guarantee consistency, availability, and partition tolerance at the same time.

Detailed Summary:
In real distributed systems, network partitions can happen. When machines cannot communicate, the system must choose between staying available or keeping every read perfectly consistent.

Key Points:
- CAP says distributed systems can only fully provide two of consistency, availability, and partition tolerance.
- Network partitions are unavoidable in real systems.
- Teams usually choose between CP and AP behavior depending on product needs.
- Paxos and Raft help distributed systems agree safely despite failures.

Things to Remember:
CP favors correctness. AP favors continued access.`,
  quiz: `Quiz from your notes

Question 1: What does CAP stand for?
A) Consistency, Availability, Partition Tolerance
B) Cache, API, Protocol
C) Connection, Access, Process
D) Consistency, Algorithm, Partition
Answer: A
Explanation: CAP stands for Consistency, Availability, and Partition Tolerance.
Topic: CAP theorem

Question 2: Why is partition tolerance unavoidable?
A) Because networks can fail or become unreachable
B) Because every database uses SQL
C) Because caching is always disabled
D) Because servers never restart
Answer: A
Explanation: Distributed systems run across networks, and networks can drop packets or split temporarily.
Topic: Distributed systems

Question 3: What is the main tradeoff during a partition?
A) CPU speed vs memory size
B) Consistency vs availability
C) UI design vs backend design
D) Passwords vs tokens
Answer: B
Explanation: During a partition, a system may choose to stay available with stale data or preserve consistency by delaying/rejecting some requests.
Topic: CAP theorem

Question 4: What does a CP system prioritize?
A) Availability over consistency
B) Consistency over availability during partitions
C) Only fast reads
D) Only UI responsiveness
Answer: B
Explanation: CP systems protect consistency even if some requests cannot be served during a partition.
Topic: CP systems

Question 5: What does an AP system prioritize?
A) Availability during partitions
B) Perfect consistency only
C) Single-server storage
D) Manual synchronization
Answer: A
Explanation: AP systems keep responding during partitions, sometimes with eventually consistent data.
Topic: AP systems
`,
  explain: `Imagine your study group is editing notes in different rooms. If the internet breaks, everyone can either keep writing and risk mismatch, or pause until everyone agrees. CAP is about that tradeoff for computers.`,
  'simple-explanation': `Simple Explanation:
Imagine you and your friends share one notebook, but the internet between you breaks.

Consistency means everyone sees the same notebook.
Availability means everyone can still use the notebook.
Partition tolerance means the group keeps working even when the internet breaks.

CAP says when the internet breaks, you usually cannot have perfect same answers and always-working access at the same time.

Real-life Example:
A chat app may let you send messages while offline, but other people may see them later.`,
  exam: `Important exam questions:
1. Explain CAP theorem with one real-world example.
2. Compare consistency and availability during a network partition.
3. Describe the Paxos prepare phase.
4. Why is Raft considered easier to understand than Paxos?`,
  'important-questions': `Very Important:
1. Explain CAP theorem with examples.
2. Differentiate between consistency and availability.
3. Why is partition tolerance unavoidable?

Medium Important:
4. Explain CP and AP systems.
5. Give examples of distributed databases and their tradeoffs.

Quick Revision:
6. Define consistency.
7. Define availability.
8. Define partition tolerance.`,
  flashcards: `Flashcards:
Front: What does C mean in CAP?
Back: Consistency, every read sees the most recent write.
Tag: CAP

Front: What does A mean in CAP?
Back: Availability, every request receives a non-error response.
Tag: CAP

Front: What does P mean in CAP?
Back: Partition tolerance, the system keeps working despite network splits.
Tag: CAP`
};

const createDemoState = () => {
  const now = new Date().toISOString();
  return {
    user: { id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@demo.nexus' },
    workspaces: [{
      _id: DEMO_WORKSPACE_ID,
      name: 'CS Final Year Workspace',
      owner: { _id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@nexus.demo' },
      members: [
        { user: { _id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@nexus.demo' }, role: 'admin' },
        { user: { _id: 'demo-user-priya', username: 'Priya Sharma', email: 'priya@nexus.demo' }, role: 'member' },
        { user: { _id: 'demo-user-rohan', username: 'Rohan Kapoor', email: 'rohan@nexus.demo' }, role: 'viewer' },
        { user: { _id: 'demo-user-sam', username: 'Sam Okafor', email: 'sam@nexus.demo' }, role: 'member' }
      ]
    }],
    documents: [
      { _id: 'demo-doc-ds-lecture', title: 'Lecture Notes', category: 'Distributed Systems', plainTextContent: DEMO_DOC_CONTENT['demo-doc-ds-lecture'], updatedAt: now },
      { _id: 'demo-doc-ds-problems', title: 'Problem Sets', category: 'Distributed Systems', plainTextContent: DEMO_DOC_CONTENT['demo-doc-ds-problems'], updatedAt: now },
      { _id: 'demo-doc-ds-exam', title: 'Exam Prep', category: 'Distributed Systems', plainTextContent: DEMO_DOC_CONTENT['demo-doc-ds-exam'], updatedAt: now },
      { _id: 'demo-doc-ml-guide', title: 'ML Study Guide', category: 'Machine Learning', plainTextContent: DEMO_DOC_CONTENT['demo-doc-ml-guide'], updatedAt: now },
      { _id: 'demo-doc-ml-eval', title: 'Model Evaluation Notes', category: 'Machine Learning', plainTextContent: DEMO_DOC_CONTENT['demo-doc-ml-eval'], updatedAt: now },
      { _id: 'demo-doc-project-plan', title: 'Final Year Project Plan', category: 'Project Work', plainTextContent: DEMO_DOC_CONTENT['demo-doc-project-plan'], updatedAt: now },
      { _id: 'demo-doc-meeting-notes', title: 'Meeting Notes', category: 'Project Work', plainTextContent: DEMO_DOC_CONTENT['demo-doc-meeting-notes'], updatedAt: now }
    ],
    channels: [
      { _id: 'demo-thread-paxos', slug: 'paxos-clarification', name: 'Clarification on Paxos Algorithm' },
      { _id: 'demo-thread-finals', slug: 'study-group-finals', name: 'Study group for finals?' },
      { _id: 'demo-thread-ml', slug: 'ml-assignment', name: 'ML assignment deadline' }
    ],
    messages: [
      { _id: 'demo-msg-1', channelId: 'general', sender: { _id: 'demo-user-priya', username: 'Priya Sharma' }, content: 'Class starts at 10 AM. I uploaded the notes from yesterday.', createdAt: now },
      { _id: 'demo-msg-2', channelId: 'general', sender: { _id: 'demo-user-rohan', username: 'Rohan Kapoor' }, content: 'Did anyone complete assignment 4?', createdAt: now },
      { _id: 'demo-msg-3', channelId: 'general', sender: { _id: 'demo-user-alex', username: 'Alex Rivera' }, content: "Question 4 is tricky. I'll share my approach after lunch.", createdAt: now }
    ],
    documentMessages: [
      { _id: 'demo-doc-msg-1', sender: { username: 'Rohan Kapoor' }, body: "Why must the acceptor only respond if n is greater than any previous prepare it has seen?", linkedText: 'When a proposer sends a prepare request with proposal number n, acceptors only promise to higher proposal numbers.', status: 'open', replies: [
        { _id: 'demo-doc-reply-1', sender: { username: 'Priya Sharma' }, body: 'Acceptors promise only to higher proposal numbers so older proposals cannot override newer ones.' },
        { _id: 'demo-doc-reply-2', sender: { username: 'Rohan Kapoor' }, body: 'That makes sense now.' }
      ] },
      { _id: 'demo-doc-msg-2', sender: { username: 'Alex Rivera' }, body: 'What does partition tolerance mean in one line?', linkedText: 'Partition tolerance means the system continues despite dropped messages.', status: 'resolved', resolvedBy: { username: 'Priya Sharma' }, resolvedAt: now, replies: [
        { _id: 'demo-doc-reply-3', sender: { username: 'Priya Sharma' }, body: 'It means the system keeps operating even when parts of the network cannot talk to each other.' }
      ] }
    ],
    documentTasks: [
      { _id: 'demo-task-1', title: 'Review CAP theorem', status: 'todo', priority: 'high', dueDate: now, assignee: { username: 'Alex Rivera' } },
      { _id: 'demo-task-2', title: 'Prepare ML quiz questions', status: 'in_progress', priority: 'medium', dueDate: now, assignee: { username: 'Priya Sharma' } },
      { _id: 'demo-task-3', title: 'Submit final year project proposal', status: 'todo', priority: 'high', dueDate: now, assignee: { username: 'Sam Okafor' } },
      { _id: 'demo-task-4', title: 'Sync notes with team', status: 'done', priority: 'low', dueDate: now, assignee: { username: 'Alex Rivera' } },
      { _id: 'demo-task-5', title: 'Revise CAP theorem', status: 'todo', priority: 'medium', dueDate: now, assignee: { username: 'Rohan Kapoor' } }
    ],
    presence: [
      { userId: 'demo-user-priya', email: 'priya@nexus.demo', cursor: { start: 68, end: 68 } },
      { userId: 'demo-user-sam', email: 'sam@nexus.demo', cursor: { start: 188, end: 188 } },
      { userId: 'demo-user-rohan', email: 'rohan@nexus.demo', cursor: null }
    ],
    activityItems: [
      { id: 'demo-activity-1', actor: 'Priya Sharma', action: 'edited', target: 'ML Study Guide', time: '2 min ago', documentId: 'demo-doc-ml-guide' },
      { id: 'demo-activity-2', actor: 'Rohan Kapoor', action: 'asked a doubt on', target: 'CAP Theorem', time: '8 min ago', documentId: 'demo-doc-ds-lecture' },
      { id: 'demo-activity-3', actor: 'Sam Okafor', action: 'completed task', target: 'Project Proposal', time: '15 min ago', documentId: 'demo-doc-project-plan' },
      { id: 'demo-activity-4', actor: 'Alex Rivera', action: 'generated quiz from', target: 'Distributed Systems Notes', time: '22 min ago', documentId: 'demo-doc-ds-lecture' }
    ]
  };
};

export { DEMO_WORKSPACE_ID, DEMO_DOC_CONTENT, DEMO_AI_OUTPUTS, createDemoState };
