const DEMO_WORKSPACE_ID = 'demo-workspace-learning-os';
const DEMO_DOC_CONTENT = {
  'demo-doc-os-deadlocks': `Operating Systems - Lecture 5: Deadlocks

Learning Goal
Understand when a system enters deadlock, how to detect it, and how prevention differs from avoidance.

Key Concepts
- Mutual exclusion: at least one resource cannot be shared.
- Hold and wait: a process holds one resource while waiting for another.
- No preemption: resources cannot be forcibly taken away.
- Circular wait: processes form a cycle of resource dependencies.

Exam Lens
Deadlock questions usually ask for the four necessary conditions, a resource allocation graph, or a Banker algorithm safety sequence.

Revision Status
Notes complete. Quiz accuracy: 60%. Needs one more revision before the OS midterm.`,
  'demo-doc-os-scheduling': `Operating Systems - Lecture 4: CPU Scheduling

Learning Goal
Compare FCFS, SJF, priority scheduling, and round robin using waiting time, turnaround time, and response time.

Key Concepts
- Waiting time: total time spent in ready queue.
- Turnaround time: completion time minus arrival time.
- Response time: first response minus arrival time.
- Round robin improves responsiveness but depends on time quantum.

Common Mistake
Students often confuse turnaround time with waiting time. Turnaround includes execution time; waiting time does not.`,
  'demo-doc-dbms-normalization': `DBMS - Lecture 3: Normalization

Learning Goal
Use functional dependencies to decompose relations and reduce update, insert, and delete anomalies.

Key Concepts
- 1NF removes repeating groups.
- 2NF removes partial dependency on a composite key.
- 3NF removes transitive dependency.
- BCNF is stricter: every determinant must be a candidate key.

Revision Status
Flashcards created. Assignment due tomorrow: normalize Library(issue_id, book_id, member_id, member_name, return_date).`,
  'demo-doc-dbms-transactions': `DBMS - Lecture 4: Transactions and ACID

Learning Goal
Explain atomicity, consistency, isolation, and durability, then connect them to concurrency control.

Key Concepts
- Atomicity: all operations commit or none do.
- Consistency: constraints remain valid before and after transaction.
- Isolation: concurrent transactions behave like serial execution.
- Durability: committed changes survive failure.`,
  'demo-doc-cn-tcp': `Computer Networks - Lecture 6: TCP Congestion Control

Learning Goal
Understand how TCP detects congestion and changes the congestion window using slow start, congestion avoidance, and fast recovery.

Key Concepts
- cwnd controls how many bytes can be in flight.
- Slow start grows cwnd exponentially until threshold.
- Congestion avoidance grows cwnd linearly.
- Packet loss usually signals congestion.

Revision Status
Not revised this week. Related topic: sliding window protocol.`,
  'demo-doc-cn-routing': `Computer Networks - Lecture 5: Routing Algorithms

Learning Goal
Compare distance vector and link state routing.

Key Concepts
- Distance vector shares route cost with neighbors.
- Link state floods topology information.
- Dijkstra computes shortest paths from global topology.
- Bellman-Ford updates distance estimates from neighbors.`
};

const DEMO_AI_OUTPUTS = {
  summarize: `Short Summary:
Deadlock happens when processes wait forever because each process holds a resource and waits for another resource in a cycle.

Detailed Summary:
Deadlock requires four conditions: mutual exclusion, hold and wait, no preemption, and circular wait. If even one condition is removed, deadlock cannot occur.

Key Points:
- Prevention breaks one necessary condition.
- Avoidance checks whether a request keeps the system in a safe state.
- Detection lets deadlocks happen, then recovers.
- Resource allocation graphs make circular wait visible.

Things to Remember:
Banker's Algorithm is about safe sequences, not just available resources.`,
  quiz: `Quiz from your lecture

Question 1: Which condition means a process holds one resource while waiting for another?
A) Hold and wait
B) Durability
C) Fragmentation
D) Polling
Answer: A
Explanation: Hold and wait is one of the four necessary deadlock conditions.
Topic: Deadlock conditions

Question 2: What does circular wait mean?
A) Processes form a cycle while waiting for resources
B) CPU repeats the same instruction
C) The disk rotates too slowly
D) A process exits normally
Answer: A
Explanation: Circular wait creates a dependency cycle among processes.
Topic: Deadlock conditions

Question 3: What does deadlock prevention do?
A) Break at least one necessary condition
B) Increase CPU clock speed
C) Disable all interrupts
D) Always use FIFO
Answer: A
Explanation: Prevention ensures one of the four necessary conditions cannot hold.
Topic: Deadlock handling

Question 4: What is the goal of the Banker algorithm?
A) Find shortest path
B) Keep the system in a safe state
C) Sort processes by priority
D) Allocate disk blocks
Answer: B
Explanation: Banker checks whether granting a request leaves a safe sequence.
Topic: Deadlock avoidance

Question 5: Which tool helps visualize resource cycles?
A) Resource allocation graph
B) ER diagram
C) Routing table
D) Parse tree
Answer: A
Explanation: Cycles in resource allocation graphs can reveal deadlock risk.
Topic: Deadlock detection
`,
  explain: `Imagine four students each holding one book and waiting for the next student's book. Nobody can move because everyone is waiting for someone else. That is deadlock.`,
  'simple-explanation': `Simple Explanation:
Imagine every student in a lab has one cable and needs one more cable from another student.

Nobody gives up their cable.
Everyone keeps waiting.
The work never starts.

That stuck situation is deadlock.

Real-life Example:
A printer queue can freeze if jobs lock files and devices in a cycle.`,
  exam: `Important exam questions:
1. State and explain the four necessary conditions for deadlock.
2. Draw a resource allocation graph and identify whether deadlock exists.
3. Explain Banker's Algorithm with a safe sequence.
4. Compare deadlock prevention, avoidance, detection, and recovery.`,
  'important-questions': `Very Important:
1. Explain the four deadlock conditions.
2. Solve a Banker Algorithm safety sequence.
3. Draw a resource allocation graph and detect cycles.

Medium Important:
4. Compare prevention and avoidance.
5. Explain recovery after deadlock detection.

Quick Revision:
6. Define hold and wait.
7. Define circular wait.
8. Define safe state.`,
  flashcards: `Flashcards:
Front: What are the four deadlock conditions?
Back: Mutual exclusion, hold and wait, no preemption, circular wait.
Tag: Deadlocks

Front: What does deadlock prevention do?
Back: It breaks at least one necessary deadlock condition.
Tag: Deadlocks

Front: What is a safe state?
Back: A state where all processes can finish in some order.
Tag: Banker Algorithm`
};

const createDemoState = () => {
  const now = new Date().toISOString();
  return {
    user: { id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@demo.nexus' },
    workspaces: [{
      _id: DEMO_WORKSPACE_ID,
      name: 'Semester 5 Exam OS',
      description: 'Learning OS demo with courses, living lectures, doubts, tasks, quizzes, and revision progress.',
      owner: { _id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@nexus.demo' },
      members: [
        { user: { _id: 'demo-user-alex', username: 'Alex Rivera', email: 'alex@nexus.demo' }, role: 'admin' },
        { user: { _id: 'demo-user-priya', username: 'Priya Sharma', email: 'priya@nexus.demo' }, role: 'member' },
        { user: { _id: 'demo-user-rohan', username: 'Rohan Kapoor', email: 'rohan@nexus.demo' }, role: 'viewer' },
        { user: { _id: 'demo-user-sam', username: 'Sam Okafor', email: 'sam@nexus.demo' }, role: 'member' }
      ]
    }],
    documents: [
      { _id: 'demo-doc-os-deadlocks', title: 'Lecture 5: Deadlocks', category: 'Operating Systems', learningMilestones: { summaryGenerated: true, aiExplanation: true, quizGenerated: true, taskCreated: true }, examWeight: 'High', quizAccuracy: 60, plainTextContent: DEMO_DOC_CONTENT['demo-doc-os-deadlocks'], updatedAt: now },
      { _id: 'demo-doc-os-scheduling', title: 'Lecture 4: CPU Scheduling', category: 'Operating Systems', learningMilestones: { summaryGenerated: true, aiExplanation: true, flashcardsGenerated: true, quizGenerated: true, taskCreated: true }, examWeight: 'High', quizAccuracy: 82, plainTextContent: DEMO_DOC_CONTENT['demo-doc-os-scheduling'], updatedAt: now },
      { _id: 'demo-doc-dbms-normalization', title: 'Lecture 3: Normalization', category: 'DBMS', learningMilestones: { flashcardsGenerated: true, taskCreated: true }, examWeight: 'High', quizAccuracy: 70, plainTextContent: DEMO_DOC_CONTENT['demo-doc-dbms-normalization'], updatedAt: now },
      { _id: 'demo-doc-dbms-transactions', title: 'Lecture 4: Transactions and ACID', category: 'DBMS', learningMilestones: { aiExplanation: true }, examWeight: 'Medium', quizAccuracy: 55, plainTextContent: DEMO_DOC_CONTENT['demo-doc-dbms-transactions'], updatedAt: now },
      { _id: 'demo-doc-cn-tcp', title: 'Lecture 6: TCP Congestion Control', category: 'Computer Networks', learningMilestones: {}, examWeight: 'High', quizAccuracy: 48, plainTextContent: DEMO_DOC_CONTENT['demo-doc-cn-tcp'], updatedAt: now },
      { _id: 'demo-doc-cn-routing', title: 'Lecture 5: Routing Algorithms', category: 'Computer Networks', learningMilestones: { summaryGenerated: true, flashcardsGenerated: true, quizGenerated: true }, examWeight: 'Medium', quizAccuracy: 76, plainTextContent: DEMO_DOC_CONTENT['demo-doc-cn-routing'], updatedAt: now }
    ],
    channels: [
      { _id: 'demo-thread-os', slug: 'os-deadlocks', name: 'OS doubts: Deadlocks' },
      { _id: 'demo-thread-dbms', slug: 'dbms-normalization', name: 'DBMS assignment' },
      { _id: 'demo-thread-cn', slug: 'cn-revision', name: 'Networks revision' }
    ],
    messages: [
      { _id: 'demo-msg-1', channelId: 'general', sender: { _id: 'demo-user-priya', username: 'Priya Sharma' }, content: 'OS midterm is in 12 days. I marked Deadlocks as high priority.', createdAt: now },
      { _id: 'demo-msg-2', channelId: 'general', sender: { _id: 'demo-user-rohan', username: 'Rohan Kapoor' }, content: 'DBMS normalization assignment is due tomorrow. Can we review 3NF examples?', createdAt: now },
      { _id: 'demo-msg-3', channelId: 'general', sender: { _id: 'demo-user-alex', username: 'Alex Rivera' }, content: "I scored 3/5 on the deadlocks quiz. Revising Banker algorithm next.", createdAt: now }
    ],
    documentMessages: [
      { _id: 'demo-doc-msg-1', sender: { username: 'Rohan Kapoor' }, body: 'Why does circular wait matter if every process is only waiting for one resource?', linkedText: 'Circular wait: processes form a cycle of resource dependencies.', status: 'open', replies: [
        { _id: 'demo-doc-reply-1', sender: { username: 'Priya Sharma' }, body: 'Because the cycle means each process is blocked by the next one, so none can release what the others need.' },
        { _id: 'demo-doc-reply-2', sender: { username: 'Alex Rivera' }, body: 'Add a resource allocation graph and it becomes visible.' }
      ] },
      { _id: 'demo-doc-msg-2', sender: { username: 'Alex Rivera' }, body: 'Is Banker algorithm prevention or avoidance?', linkedText: 'Avoidance checks whether a request keeps the system in a safe state.', status: 'resolved', resolvedBy: { username: 'Priya Sharma' }, resolvedAt: now, replies: [
        { _id: 'demo-doc-reply-3', sender: { username: 'Priya Sharma' }, body: 'Avoidance. It checks safety before granting requests.' }
      ] }
    ],
    documentTasks: [
      { _id: 'demo-task-1', title: 'Revise Deadlocks before dinner', status: 'todo', priority: 'high', dueDate: now, documentId: 'demo-doc-os-deadlocks', assignee: { username: 'Alex Rivera' } },
      { _id: 'demo-task-2', title: 'Solve 5 CPU Scheduling numericals', status: 'done', priority: 'medium', dueDate: now, documentId: 'demo-doc-os-scheduling', assignee: { username: 'Priya Sharma' }, completedAt: now },
      { _id: 'demo-task-3', title: 'Submit DBMS normalization assignment', status: 'todo', priority: 'high', dueDate: now, documentId: 'demo-doc-dbms-normalization', assignee: { username: 'Sam Okafor' } },
      { _id: 'demo-task-4', title: 'Finish TCP congestion flashcards', status: 'todo', priority: 'medium', dueDate: now, documentId: 'demo-doc-cn-tcp', assignee: { username: 'Alex Rivera' } },
      { _id: 'demo-task-5', title: 'Review ACID isolation examples', status: 'done', priority: 'low', dueDate: now, documentId: 'demo-doc-dbms-transactions', assignee: { username: 'Rohan Kapoor' } }
    ],
    presence: [
      { userId: 'demo-user-priya', email: 'priya@nexus.demo', cursor: { start: 68, end: 68 } },
      { userId: 'demo-user-sam', email: 'sam@nexus.demo', cursor: { start: 188, end: 188 } },
      { userId: 'demo-user-rohan', email: 'rohan@nexus.demo', cursor: null }
    ],
    activityItems: [
      { id: 'demo-activity-1', actor: 'Priya Sharma', action: 'revised', target: 'CPU Scheduling', time: '2 min ago', documentId: 'demo-doc-os-scheduling' },
      { id: 'demo-activity-2', actor: 'Rohan Kapoor', action: 'asked a doubt on', target: 'Deadlocks circular wait', time: '8 min ago', documentId: 'demo-doc-os-deadlocks' },
      { id: 'demo-activity-3', actor: 'Sam Okafor', action: 'created task for', target: 'DBMS assignment', time: '15 min ago', documentId: 'demo-doc-dbms-normalization' },
      { id: 'demo-activity-4', actor: 'Alex Rivera', action: 'generated quiz from', target: 'Deadlocks', time: '22 min ago', documentId: 'demo-doc-os-deadlocks' }
    ]
  };
};

export { DEMO_WORKSPACE_ID, DEMO_DOC_CONTENT, DEMO_AI_OUTPUTS, createDemoState };
