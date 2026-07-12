const bcrypt = require('../backend/node_modules/bcryptjs');
const mongoose = require('../backend/node_modules/mongoose');
require('../backend/node_modules/dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const models = require('../backend/models');
const email = 'test-yjs-fix@nexus.local';
async function cleanup() {
  const users = await models.User.find({ email }).select('_id');
  const userIds = users.map(x => x._id);
  const workspaces = await models.Workspace.find({ owner: { $in: userIds } }).select('_id');
  const workspaceIds = workspaces.map(x => x._id);
  for (const [name, Model] of Object.entries(models)) {
    if (['User', 'Workspace'].includes(name)) continue;
    const clauses = [];
    if (Model.schema.path('user')) clauses.push({ user: { $in: userIds } });
    if (Model.schema.path('actor')) clauses.push({ actor: { $in: userIds } });
    if (Model.schema.path('workspace')) clauses.push({ workspace: { $in: workspaceIds } });
    if (clauses.length) await Model.deleteMany({ $or: clauses });
  }
  await models.Workspace.deleteMany({ _id: { $in: workspaceIds } });
  await models.User.deleteMany({ _id: { $in: userIds } });
  return { users: userIds.length, workspaces: workspaceIds.length };
}
async function seed() {
  await cleanup();
  const user = await models.User.create({ username: 'yjs_fix_temp', fullName: 'Yjs Fix Temp', email, passwordHash: await bcrypt.hash('NexusVerify!2026', 12), authProvider: 'email', emailVerifiedAt: new Date() });
  const workspace = await models.Workspace.create({ name: 'Yjs Fix Verification', owner: user._id, members: [{ user: user._id, role: 'admin' }] });
  const document = await models.Document.create({ title: 'Collaboration Baseline', workspace: workspace._id, plainTextContent: 'Baseline', contentHtml: 'Baseline', lastEditedBy: user._id });
  await models.Channel.create({ workspace: workspace._id, name: 'General', slug: 'general', createdBy: user._id });
  return { email, password: 'NexusVerify!2026', workspaceId: String(workspace._id), documentId: String(document._id) };
}
(async()=>{await mongoose.connect(process.env.MONGO_URI);console.log(JSON.stringify(process.argv[2] === 'seed' ? await seed() : await cleanup()));await mongoose.disconnect()})().catch(async e=>{console.error(e);await mongoose.disconnect().catch(()=>{});process.exit(1)});
