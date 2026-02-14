/**
 * Seed realistic demo data for user: adelekeifeoluwase@gmail.com
 *
 * Run: node scripts/seed-demo-user.js
 *
 * This script populates:
 * - OrgPositions (team/org chart)
 * - TeamMembers (for assignments)
 * - Products
 * - Departments
 * - CoreProjects with deliverables
 * - DepartmentProjects with deliverables
 * - RevenueStreams
 * - FinancialBaseline
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

// Models
const User = require('../src/models/User');
const Workspace = require('../src/models/Workspace');
const OrgPosition = require('../src/models/OrgPosition');
const TeamMember = require('../src/models/TeamMember');
const Product = require('../src/models/Product');
const Department = require('../src/models/Department');
const CoreProject = require('../src/models/CoreProject');
const DepartmentProject = require('../src/models/DepartmentProject');
const RevenueStream = require('../src/models/RevenueStream');
const FinancialBaseline = require('../src/models/FinancialBaseline');

const TARGET_EMAIL = 'adelekeifeoluwase@gmail.com';

// Generate unique IDs
const genId = () => crypto.randomBytes(6).toString('hex');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Find the user
  const user = await User.findOne({ email: TARGET_EMAIL });
  if (!user) {
    console.error(`User not found: ${TARGET_EMAIL}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found user: ${user._id} (${user.fullName || user.firstName})`);

  // Find their default workspace
  const workspace = await Workspace.findOne({ user: user._id, defaultWorkspace: true });
  if (!workspace) {
    console.error('No default workspace found for user');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found workspace: ${workspace.wid} (${workspace.name})`);

  const userId = user._id;
  const workspaceId = workspace._id;

  // Clear existing data for this user (to allow re-running)
  console.log('\nClearing existing data...');
  await Promise.all([
    OrgPosition.deleteMany({ workspace: workspaceId }),
    TeamMember.deleteMany({ workspace: workspaceId }),
    Product.deleteMany({ workspace: workspaceId }),
    Department.deleteMany({ workspace: workspaceId }),
    CoreProject.deleteMany({ workspace: workspaceId }),
    DepartmentProject.deleteMany({ workspace: workspaceId }),
    RevenueStream.deleteMany({ workspace: workspaceId }),
    FinancialBaseline.deleteMany({ workspace: workspaceId }),
  ]);
  console.log('Cleared existing data');

  // ============================================================
  // 1. ORG POSITIONS (Team Hierarchy)
  // ============================================================
  console.log('\nCreating org positions...');

  // CEO first (no parent)
  const ceo = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Chief Executive Officer',
    role: 'Leads overall company strategy and operations',
    name: 'Adeleke Ifeoluwase',
    email: 'adelekeifeoluwase@gmail.com',
    department: 'Executive',
    parentId: null,
    order: 0,
  });

  // C-Suite (reports to CEO)
  const cto = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Chief Technology Officer',
    role: 'Oversees product development and technical strategy',
    name: 'Chinedu Okafor',
    email: 'chinedu.o@company.com',
    department: 'Technology',
    parentId: ceo._id,
    order: 1,
  });

  const coo = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Chief Operating Officer',
    role: 'Manages day-to-day operations and client delivery',
    name: 'Amara Nwosu',
    email: 'amara.n@company.com',
    department: 'Operations',
    parentId: ceo._id,
    order: 2,
  });

  const cfo = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Chief Financial Officer',
    role: 'Oversees financial planning and investor relations',
    name: 'Olumide Adeyemi',
    email: 'olumide.a@company.com',
    department: 'Finance',
    parentId: ceo._id,
    order: 3,
  });

  const cmo = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Chief Marketing Officer',
    role: 'Leads brand strategy and growth marketing',
    name: 'Funke Adebayo',
    email: 'funke.a@company.com',
    department: 'Marketing',
    parentId: ceo._id,
    order: 4,
  });

  // Tech Team (reports to CTO)
  const leadDev = await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Lead Developer',
    role: 'Leads engineering team and architecture decisions',
    name: 'Emeka Eze',
    email: 'emeka.e@company.com',
    department: 'Technology',
    parentId: cto._id,
    order: 5,
  });

  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Senior Frontend Developer',
    role: 'Builds and maintains user interfaces',
    name: 'Ngozi Uche',
    email: 'ngozi.u@company.com',
    department: 'Technology',
    parentId: leadDev._id,
    order: 6,
  });

  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Backend Developer',
    role: 'Develops APIs and server infrastructure',
    name: 'Tunde Bakare',
    email: 'tunde.b@company.com',
    department: 'Technology',
    parentId: leadDev._id,
    order: 7,
  });

  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Product Designer',
    role: 'Designs user experiences and interfaces',
    name: 'Kemi Oladipo',
    email: 'kemi.o@company.com',
    department: 'Technology',
    parentId: cto._id,
    order: 8,
  });

  // Operations Team (reports to COO)
  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Project Manager',
    role: 'Manages client projects and timelines',
    name: 'Bola Akinwale',
    email: 'bola.a@company.com',
    department: 'Operations',
    parentId: coo._id,
    order: 9,
  });

  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Customer Success Lead',
    role: 'Ensures client satisfaction and retention',
    name: 'Sade Olowu',
    email: 'sade.o@company.com',
    department: 'Operations',
    parentId: coo._id,
    order: 10,
  });

  // Marketing Team (reports to CMO)
  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Content Marketing Manager',
    role: 'Creates and distributes marketing content',
    name: 'Yemi Fashola',
    email: 'yemi.f@company.com',
    department: 'Marketing',
    parentId: cmo._id,
    order: 11,
  });

  await OrgPosition.create({
    workspace: workspaceId,
    user: userId,
    position: 'Growth Marketing Specialist',
    role: 'Runs paid campaigns and growth experiments',
    name: 'Dayo Olufemi',
    email: 'dayo.o@company.com',
    department: 'Marketing',
    parentId: cmo._id,
    order: 12,
  });

  console.log('Created 13 org positions');

  // ============================================================
  // 2. TEAM MEMBERS (for assignment dropdowns)
  // ============================================================
  console.log('\nCreating team members...');

  const teamMembersData = [
    { name: 'Adeleke Ifeoluwase', email: 'adelekeifeoluwase@gmail.com', role: 'Admin', department: 'Executive' },
    { name: 'Chinedu Okafor', email: 'chinedu.o@company.com', role: 'Admin', department: 'Technology' },
    { name: 'Amara Nwosu', email: 'amara.n@company.com', role: 'Admin', department: 'Operations' },
    { name: 'Olumide Adeyemi', email: 'olumide.a@company.com', role: 'Editor', department: 'Finance' },
    { name: 'Funke Adebayo', email: 'funke.a@company.com', role: 'Editor', department: 'Marketing' },
    { name: 'Emeka Eze', email: 'emeka.e@company.com', role: 'Editor', department: 'Technology' },
    { name: 'Ngozi Uche', email: 'ngozi.u@company.com', role: 'Editor', department: 'Technology' },
    { name: 'Tunde Bakare', email: 'tunde.b@company.com', role: 'Editor', department: 'Technology' },
    { name: 'Kemi Oladipo', email: 'kemi.o@company.com', role: 'Editor', department: 'Technology' },
    { name: 'Bola Akinwale', email: 'bola.a@company.com', role: 'Editor', department: 'Operations' },
    { name: 'Sade Olowu', email: 'sade.o@company.com', role: 'Editor', department: 'Operations' },
    { name: 'Yemi Fashola', email: 'yemi.f@company.com', role: 'Editor', department: 'Marketing' },
    { name: 'Dayo Olufemi', email: 'dayo.o@company.com', role: 'Editor', department: 'Marketing' },
  ];

  const teamMembers = [];
  for (let i = 0; i < teamMembersData.length; i++) {
    const tm = await TeamMember.create({
      user: userId,
      workspace: workspaceId,
      mid: `tm_${genId()}`,
      ...teamMembersData[i],
      status: 'Active',
    });
    teamMembers.push(tm);
  }
  console.log(`Created ${teamMembers.length} team members`);

  // ============================================================
  // 3. PRODUCTS/SERVICES
  // ============================================================
  console.log('\nCreating products/services...');

  const productsData = [
    { name: 'Strategy Consulting', description: 'Business strategy and planning services for growing companies', price: '5000', unitCost: '1500', monthlyVolume: '4' },
    { name: 'Digital Transformation', description: 'End-to-end digital transformation solutions', price: '15000', unitCost: '6000', monthlyVolume: '2' },
    { name: 'Executive Coaching', description: 'One-on-one coaching for C-suite executives', price: '2500', unitCost: '500', monthlyVolume: '8' },
    { name: 'Workshop Facilitation', description: 'Strategic planning and team alignment workshops', price: '3500', unitCost: '800', monthlyVolume: '3' },
    { name: 'Market Research', description: 'Comprehensive market analysis and competitive intelligence', price: '8000', unitCost: '2500', monthlyVolume: '2' },
  ];

  for (let i = 0; i < productsData.length; i++) {
    await Product.create({
      workspace: workspaceId,
      user: userId,
      ...productsData[i],
      order: i,
    });
  }
  console.log(`Created ${productsData.length} products`);

  // ============================================================
  // 4. DEPARTMENTS
  // ============================================================
  console.log('\nCreating departments...');

  const departmentsData = [
    { name: 'Technology', owner: 'Chinedu Okafor', progress: 72, status: 'on-track' },
    { name: 'Operations', owner: 'Amara Nwosu', progress: 65, status: 'in-progress' },
    { name: 'Marketing', owner: 'Funke Adebayo', progress: 58, status: 'in-progress' },
    { name: 'Finance', owner: 'Olumide Adeyemi', progress: 80, status: 'on-track' },
    { name: 'Sales', owner: 'Bola Akinwale', progress: 45, status: 'at-risk' },
  ];

  for (const dept of departmentsData) {
    await Department.create({
      user: userId,
      workspace: workspaceId,
      ...dept,
      dueDate: 'Q2 2026',
    });
  }
  console.log(`Created ${departmentsData.length} departments`);

  // ============================================================
  // 5. CORE PROJECTS
  // ============================================================
  console.log('\nCreating core projects...');

  const coreProjectsData = [
    {
      title: 'Launch AI-Powered Planning Module',
      description: 'Develop and launch an AI-driven strategic planning module that helps clients create actionable business plans in minutes',
      goal: 'Increase product value and differentiate from competitors',
      dueWhen: 'March 2026',
      priority: 'high',
      ownerId: teamMembers[1].mid,
      ownerName: 'Chinedu Okafor',
      departments: ['technology', 'operations'],
      deliverables: [
        { text: 'Complete AI model training with industry data', done: true, kpi: 'Model accuracy > 90%', dueWhen: 'Week 2', ownerId: teamMembers[5].mid, ownerName: 'Emeka Eze' },
        { text: 'Build frontend interface for planning wizard', done: true, kpi: 'User completion rate > 80%', dueWhen: 'Week 4', ownerId: teamMembers[6].mid, ownerName: 'Ngozi Uche' },
        { text: 'Integrate with existing dashboard', done: false, kpi: 'Zero breaking changes', dueWhen: 'Week 6', ownerId: teamMembers[7].mid, ownerName: 'Tunde Bakare' },
        { text: 'Beta testing with 10 pilot clients', done: false, kpi: 'NPS > 8', dueWhen: 'Week 8', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
      ],
    },
    {
      title: 'Expand into East African Market',
      description: 'Establish presence in Kenya and Tanzania through partnerships and local marketing campaigns',
      goal: 'Achieve 30% revenue growth from new markets',
      dueWhen: 'Q2 2026',
      priority: 'high',
      ownerId: teamMembers[4].mid,
      ownerName: 'Funke Adebayo',
      departments: ['marketing', 'sales'],
      deliverables: [
        { text: 'Identify and engage 5 strategic partners', done: true, kpi: '3 signed MOUs', dueWhen: 'Month 1', ownerId: teamMembers[4].mid, ownerName: 'Funke Adebayo' },
        { text: 'Launch localized marketing campaign', done: false, kpi: '10,000 impressions', dueWhen: 'Month 2', ownerId: teamMembers[11].mid, ownerName: 'Yemi Fashola' },
        { text: 'Host virtual launch event', done: false, kpi: '200+ attendees', dueWhen: 'Month 3', ownerId: teamMembers[12].mid, ownerName: 'Dayo Olufemi' },
        { text: 'Onboard first 20 East African clients', done: false, kpi: 'Revenue: $50,000', dueWhen: 'Month 4', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
      ],
    },
    {
      title: 'Implement Customer Success Program',
      description: 'Build a proactive customer success program to improve retention and reduce churn',
      goal: 'Reduce churn rate from 8% to 3%',
      dueWhen: 'April 2026',
      priority: 'medium',
      ownerId: teamMembers[10].mid,
      ownerName: 'Sade Olowu',
      departments: ['operations'],
      deliverables: [
        { text: 'Design customer health scoring system', done: true, kpi: 'Model validated', dueWhen: 'Week 2', ownerId: teamMembers[10].mid, ownerName: 'Sade Olowu' },
        { text: 'Set up automated check-in workflows', done: true, kpi: '100% coverage', dueWhen: 'Week 4', ownerId: teamMembers[7].mid, ownerName: 'Tunde Bakare' },
        { text: 'Train team on new success playbooks', done: false, kpi: 'All team certified', dueWhen: 'Week 6', ownerId: teamMembers[2].mid, ownerName: 'Amara Nwosu' },
        { text: 'Launch quarterly business reviews', done: false, kpi: '90% client participation', dueWhen: 'Week 8', ownerId: teamMembers[10].mid, ownerName: 'Sade Olowu' },
      ],
    },
    {
      title: 'Secure Series A Funding',
      description: 'Raise $3M Series A to fuel expansion and product development',
      goal: 'Close funding round with favorable terms',
      dueWhen: 'June 2026',
      priority: 'high',
      ownerId: teamMembers[3].mid,
      ownerName: 'Olumide Adeyemi',
      departments: ['finance'],
      deliverables: [
        { text: 'Update pitch deck and financial model', done: true, kpi: 'Board approved', dueWhen: 'Month 1', ownerId: teamMembers[3].mid, ownerName: 'Olumide Adeyemi' },
        { text: 'Engage with 20 target investors', done: true, kpi: '10 meetings booked', dueWhen: 'Month 2', ownerId: teamMembers[0].mid, ownerName: 'Adeleke Ifeoluwase' },
        { text: 'Complete due diligence process', done: false, kpi: 'Data room ready', dueWhen: 'Month 3', ownerId: teamMembers[3].mid, ownerName: 'Olumide Adeyemi' },
        { text: 'Close term sheet negotiation', done: false, kpi: 'Terms signed', dueWhen: 'Month 4', ownerId: teamMembers[0].mid, ownerName: 'Adeleke Ifeoluwase' },
      ],
    },
    {
      title: 'Launch Premium Enterprise Tier',
      description: 'Create and launch enterprise pricing tier with dedicated support and custom features',
      goal: 'Generate $500K ARR from enterprise clients',
      dueWhen: 'May 2026',
      priority: 'medium',
      ownerId: teamMembers[0].mid,
      ownerName: 'Adeleke Ifeoluwase',
      departments: ['technology', 'sales', 'operations'],
      deliverables: [
        { text: 'Define enterprise feature requirements', done: true, kpi: 'Feature list approved', dueWhen: 'Week 2', ownerId: teamMembers[8].mid, ownerName: 'Kemi Oladipo' },
        { text: 'Build SSO and admin console', done: false, kpi: 'Security audit passed', dueWhen: 'Week 6', ownerId: teamMembers[5].mid, ownerName: 'Emeka Eze' },
        { text: 'Create enterprise sales playbook', done: false, kpi: 'Team trained', dueWhen: 'Week 8', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
        { text: 'Sign first 3 enterprise clients', done: false, kpi: '$150K TCV', dueWhen: 'Week 12', ownerId: teamMembers[0].mid, ownerName: 'Adeleke Ifeoluwase' },
      ],
    },
  ];

  for (let i = 0; i < coreProjectsData.length; i++) {
    await CoreProject.create({
      workspace: workspaceId,
      user: userId,
      ...coreProjectsData[i],
      order: i,
    });
  }
  console.log(`Created ${coreProjectsData.length} core projects`);

  // ============================================================
  // 6. DEPARTMENT PROJECTS
  // ============================================================
  console.log('\nCreating department projects...');

  const deptProjectsData = [
    // Technology
    {
      departmentKey: 'technology',
      title: 'Upgrade Infrastructure to Kubernetes',
      goal: 'Improve scalability and reduce deployment time',
      milestone: 'Full migration by Q1 end',
      resources: 'DevOps team + AWS credits',
      dueWhen: 'March 2026',
      priority: 'high',
      firstName: 'Emeka',
      lastName: 'Eze',
      ownerId: teamMembers[5].mid,
      deliverables: [
        { text: 'Set up Kubernetes cluster on AWS EKS', done: true, kpi: 'Cluster operational', dueWhen: 'Week 2', ownerId: teamMembers[5].mid, ownerName: 'Emeka Eze' },
        { text: 'Migrate staging environment', done: true, kpi: 'All services running', dueWhen: 'Week 4', ownerId: teamMembers[7].mid, ownerName: 'Tunde Bakare' },
        { text: 'Migrate production environment', done: false, kpi: 'Zero downtime', dueWhen: 'Week 6', ownerId: teamMembers[5].mid, ownerName: 'Emeka Eze' },
      ],
    },
    {
      departmentKey: 'technology',
      title: 'Implement Design System',
      goal: 'Create consistent UI/UX across all products',
      milestone: 'Design system v1.0 released',
      resources: 'Design team',
      dueWhen: 'April 2026',
      priority: 'medium',
      firstName: 'Kemi',
      lastName: 'Oladipo',
      ownerId: teamMembers[8].mid,
      deliverables: [
        { text: 'Audit existing components', done: true, kpi: 'Inventory complete', dueWhen: 'Week 1', ownerId: teamMembers[8].mid, ownerName: 'Kemi Oladipo' },
        { text: 'Create component library in Figma', done: true, kpi: '50+ components', dueWhen: 'Week 3', ownerId: teamMembers[8].mid, ownerName: 'Kemi Oladipo' },
        { text: 'Build React component library', done: false, kpi: 'Published to npm', dueWhen: 'Week 5', ownerId: teamMembers[6].mid, ownerName: 'Ngozi Uche' },
      ],
    },
    // Operations
    {
      departmentKey: 'operations',
      title: 'Streamline Client Onboarding',
      goal: 'Reduce onboarding time from 2 weeks to 3 days',
      milestone: 'New process live for all clients',
      resources: 'Operations team + automation tools',
      dueWhen: 'February 2026',
      priority: 'high',
      firstName: 'Amara',
      lastName: 'Nwosu',
      ownerId: teamMembers[2].mid,
      deliverables: [
        { text: 'Map current onboarding workflow', done: true, kpi: 'Process documented', dueWhen: 'Week 1', ownerId: teamMembers[2].mid, ownerName: 'Amara Nwosu' },
        { text: 'Identify automation opportunities', done: true, kpi: '5+ automations identified', dueWhen: 'Week 2', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
        { text: 'Implement automated welcome sequence', done: false, kpi: 'Emails automated', dueWhen: 'Week 3', ownerId: teamMembers[10].mid, ownerName: 'Sade Olowu' },
      ],
    },
    {
      departmentKey: 'operations',
      title: 'Build Knowledge Base',
      goal: 'Create self-service support resources',
      milestone: 'Knowledge base with 100+ articles',
      resources: 'Content team + support data',
      dueWhen: 'April 2026',
      priority: 'medium',
      firstName: 'Sade',
      lastName: 'Olowu',
      ownerId: teamMembers[10].mid,
      deliverables: [
        { text: 'Analyze top 50 support tickets', done: true, kpi: 'Topics identified', dueWhen: 'Week 2', ownerId: teamMembers[10].mid, ownerName: 'Sade Olowu' },
        { text: 'Write first 30 help articles', done: false, kpi: 'Articles published', dueWhen: 'Week 4', ownerId: teamMembers[10].mid, ownerName: 'Sade Olowu' },
        { text: 'Set up search and navigation', done: false, kpi: 'Search working', dueWhen: 'Week 5', ownerId: teamMembers[7].mid, ownerName: 'Tunde Bakare' },
      ],
    },
    // Marketing
    {
      departmentKey: 'marketing',
      title: 'Launch Content Marketing Engine',
      goal: 'Increase organic traffic by 200%',
      milestone: 'Publishing 4 articles per week',
      resources: 'Content team + SEO tools',
      dueWhen: 'March 2026',
      priority: 'high',
      firstName: 'Yemi',
      lastName: 'Fashola',
      ownerId: teamMembers[11].mid,
      deliverables: [
        { text: 'Complete keyword research', done: true, kpi: '100 target keywords', dueWhen: 'Week 1', ownerId: teamMembers[11].mid, ownerName: 'Yemi Fashola' },
        { text: 'Create content calendar for Q1', done: true, kpi: '48 topics planned', dueWhen: 'Week 2', ownerId: teamMembers[11].mid, ownerName: 'Yemi Fashola' },
        { text: 'Write and publish first 12 articles', done: false, kpi: 'Articles live', dueWhen: 'Week 5', ownerId: teamMembers[11].mid, ownerName: 'Yemi Fashola' },
      ],
    },
    {
      departmentKey: 'marketing',
      title: 'Rebrand Visual Identity',
      goal: 'Modernize brand to appeal to enterprise clients',
      milestone: 'New brand guidelines released',
      resources: 'Design agency + internal team',
      dueWhen: 'May 2026',
      priority: 'medium',
      firstName: 'Funke',
      lastName: 'Adebayo',
      ownerId: teamMembers[4].mid,
      deliverables: [
        { text: 'Complete brand audit', done: true, kpi: 'Report delivered', dueWhen: 'Week 2', ownerId: teamMembers[4].mid, ownerName: 'Funke Adebayo' },
        { text: 'Finalize new logo and colors', done: false, kpi: 'CEO approved', dueWhen: 'Week 4', ownerId: teamMembers[8].mid, ownerName: 'Kemi Oladipo' },
        { text: 'Update all marketing materials', done: false, kpi: '100% updated', dueWhen: 'Week 8', ownerId: teamMembers[12].mid, ownerName: 'Dayo Olufemi' },
      ],
    },
    // Finance
    {
      departmentKey: 'finance',
      title: 'Implement Financial Reporting Dashboard',
      goal: 'Real-time visibility into financial metrics',
      milestone: 'Dashboard live with key metrics',
      resources: 'Finance team + BI tool',
      dueWhen: 'February 2026',
      priority: 'high',
      firstName: 'Olumide',
      lastName: 'Adeyemi',
      ownerId: teamMembers[3].mid,
      deliverables: [
        { text: 'Define key financial KPIs', done: true, kpi: '15 KPIs defined', dueWhen: 'Week 1', ownerId: teamMembers[3].mid, ownerName: 'Olumide Adeyemi' },
        { text: 'Connect data sources', done: true, kpi: 'All sources integrated', dueWhen: 'Week 2', ownerId: teamMembers[7].mid, ownerName: 'Tunde Bakare' },
        { text: 'Build and deploy dashboard', done: false, kpi: 'Dashboard live', dueWhen: 'Week 3', ownerId: teamMembers[3].mid, ownerName: 'Olumide Adeyemi' },
      ],
    },
    // Sales
    {
      departmentKey: 'sales',
      title: 'Build Outbound Sales Machine',
      goal: 'Generate 50 qualified leads per month',
      milestone: 'Sales process documented and running',
      resources: 'Sales team + CRM',
      dueWhen: 'March 2026',
      priority: 'high',
      firstName: 'Bola',
      lastName: 'Akinwale',
      ownerId: teamMembers[9].mid,
      deliverables: [
        { text: 'Define ideal customer profile', done: true, kpi: 'ICP documented', dueWhen: 'Week 1', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
        { text: 'Build prospect list of 500 companies', done: true, kpi: 'List ready', dueWhen: 'Week 2', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
        { text: 'Launch outbound email sequence', done: false, kpi: '20% open rate', dueWhen: 'Week 3', ownerId: teamMembers[12].mid, ownerName: 'Dayo Olufemi' },
        { text: 'Book first 20 demo calls', done: false, kpi: '20 demos', dueWhen: 'Week 6', ownerId: teamMembers[9].mid, ownerName: 'Bola Akinwale' },
      ],
    },
  ];

  for (let i = 0; i < deptProjectsData.length; i++) {
    await DepartmentProject.create({
      workspace: workspaceId,
      user: userId,
      ...deptProjectsData[i],
      order: i % 2,
    });
  }
  console.log(`Created ${deptProjectsData.length} department projects`);

  // ============================================================
  // 7. REVENUE STREAMS
  // ============================================================
  console.log('\nCreating revenue streams...');

  const revenueStreamsData = [
    {
      name: 'Strategy Consulting Retainers',
      description: 'Monthly retainer clients for ongoing strategic advisory',
      type: 'ongoing_retainer',
      isPrimary: true,
      inputs: {
        monthlyFee: 5000,
        numberOfClients: 8,
        avgClientLifespanMonths: 12,
      },
    },
    {
      name: 'Digital Transformation Projects',
      description: 'One-time digital transformation engagements',
      type: 'one_off_project',
      isPrimary: false,
      inputs: {
        projectPrice: 25000,
        projectsPerMonth: 2,
        deliveryCostPerProject: 8000,
      },
    },
    {
      name: 'Executive Coaching Sessions',
      description: 'Hourly executive coaching and mentorship',
      type: 'time_based',
      isPrimary: false,
      inputs: {
        hourlyRate: 350,
        hoursPerMonth: 40,
        capacityLimitHours: 60,
      },
    },
    {
      name: 'Strategic Planning Workshops',
      description: 'Quarterly strategic planning workshops for teams',
      type: 'program_cohort',
      isPrimary: false,
      inputs: {
        pricePerParticipant: 500,
        cohortSize: 15,
        cohortsPerYear: 12,
        deliveryCostPerCohort: 1500,
      },
    },
    {
      name: 'SaaS Platform Subscriptions',
      description: 'Monthly subscriptions to our planning platform',
      type: 'ongoing_retainer',
      isPrimary: false,
      inputs: {
        monthlyFee: 199,
        numberOfClients: 120,
        avgClientLifespanMonths: 18,
      },
    },
  ];

  for (const stream of revenueStreamsData) {
    await RevenueStream.create({
      user: userId,
      workspace: workspaceId,
      rsid: `rs_${genId()}`,
      ...stream,
    });
  }
  console.log(`Created ${revenueStreamsData.length} revenue streams`);

  // ============================================================
  // 8. FINANCIAL BASELINE
  // ============================================================
  console.log('\nCreating financial baseline...');

  const financialBaseline = new FinancialBaseline({
    user: userId,
    workspace: workspaceId,
    revenue: {
      totalMonthlyRevenue: 137880, // Will be synced from revenue streams
      totalMonthlyDeliveryCost: 17500,
      streamCount: 5,
      lastSyncedAt: new Date(),
    },
    workRelatedCosts: {
      items: [
        { id: genId(), category: 'contractors', amount: 8000, description: 'Freelance developers' },
        { id: genId(), category: 'contractors', amount: 5000, description: 'Design contractors' },
        { id: genId(), category: 'commissions', amount: 4500, description: 'Sales commissions' },
        { id: genId(), category: 'materials', amount: 1200, description: 'Workshop materials' },
        { id: genId(), category: 'other', amount: 800, description: 'Client gifts' },
      ],
      total: 19500,
    },
    fixedCosts: {
      items: [
        { id: genId(), category: 'salaries', amount: 45000, description: 'Full-time team salaries' },
        { id: genId(), category: 'rent', amount: 4500, description: 'Office space' },
        { id: genId(), category: 'software', amount: 3200, description: 'SaaS subscriptions' },
        { id: genId(), category: 'marketing', amount: 8000, description: 'Marketing spend' },
        { id: genId(), category: 'insurance', amount: 1500, description: 'Business insurance' },
        { id: genId(), category: 'utilities', amount: 600, description: 'Internet and utilities' },
        { id: genId(), category: 'other', amount: 2000, description: 'Professional services' },
      ],
      total: 64800,
    },
    cash: {
      currentBalance: 285000,
      expectedFunding: 500000,
      fundingDate: new Date('2026-06-01'),
      fundingType: 'investment',
    },
    lastConfirmedAt: new Date(),
    lastConfirmedBy: userId,
  });

  // This will auto-calculate metrics and forecast on save
  await financialBaseline.save();
  console.log('Created financial baseline with metrics and forecast');

  // ============================================================
  // 9. Update Workspace Fields (Vision, Values, etc.)
  // ============================================================
  console.log('\nUpdating workspace fields...');

  workspace.fields = new Map([
    ['visionStatement', 'To become the leading AI-powered strategic planning platform in Africa, empowering 10,000 businesses to achieve sustainable growth by 2028.'],
    ['purposeStatement', 'We exist to democratize strategic planning, making expert-level business guidance accessible to every entrepreneur and business leader.'],
    ['coreValues', [
      { value: 'Innovation First', description: 'We constantly push boundaries and embrace new technologies to deliver breakthrough solutions.' },
      { value: 'Client Obsession', description: 'Our clients success is our success. We go above and beyond to ensure their growth.' },
      { value: 'Radical Transparency', description: 'We believe in open communication and honest feedback, internally and externally.' },
      { value: 'Continuous Learning', description: 'We are committed to growth, both as individuals and as an organization.' },
    ]],
    ['culturePillars', [
      { pillar: 'Collaborative Excellence', description: 'We achieve more together than alone. Every voice matters.' },
      { pillar: 'Bold Experimentation', description: 'We take calculated risks and learn fast from both successes and failures.' },
      { pillar: 'Impact-Driven', description: 'Every action we take should create measurable value for our stakeholders.' },
    ]],
    ['marketPosition', 'Premium AI-powered strategic planning SaaS for SMEs in Africa'],
    ['targetCustomers', 'Growing businesses (50-500 employees) in tech, consulting, and professional services across Africa'],
    ['competitiveAdvantage', 'First-mover in AI-powered planning for African market context, combined with local expertise'],
    ['yearOneGoals', [
      { goal: 'Reach $2M ARR by end of 2026', status: 'on-track' },
      { goal: 'Expand to 3 new African markets', status: 'in-progress' },
      { goal: 'Launch enterprise tier with 10+ clients', status: 'in-progress' },
      { goal: 'Close Series A funding round', status: 'at-risk' },
      { goal: 'Grow team to 25 people', status: 'on-track' },
    ]],
    ['threeYearVision', 'By 2029, we aim to be the go-to strategic planning platform for 5,000+ businesses across Africa, with presence in 10 countries and $10M+ ARR.'],
  ]);

  await workspace.save();
  console.log('Updated workspace fields');

  // ============================================================
  // Done!
  // ============================================================
  console.log('\n✅ Seed completed successfully!');
  console.log(`   User: ${TARGET_EMAIL}`);
  console.log(`   Workspace: ${workspace.name} (${workspace.wid})`);
  console.log('\n   Created:');
  console.log(`   - 13 org positions (team hierarchy)`);
  console.log(`   - 13 team members`);
  console.log(`   - 5 products/services`);
  console.log(`   - 5 departments`);
  console.log(`   - 5 core projects with deliverables`);
  console.log(`   - 8 department projects with deliverables`);
  console.log(`   - 5 revenue streams`);
  console.log(`   - 1 financial baseline with forecast`);
  console.log(`   - Workspace vision, values, and goals`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
