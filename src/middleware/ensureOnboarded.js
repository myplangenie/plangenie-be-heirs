const User = require('../models/User');
const Onboarding = require('../models/Onboarding');
const Workspace = require('../models/Workspace');

// Ensures the authenticated user has completed onboarding and onboarding detail for the current workspace
module.exports = async function ensureOnboarded(req, res, next) {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });
    const user = await User.findById(id).lean().exec();
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    // First phase onboarding (profile setup) is still user-level
    const completed = Boolean(user.onboardingDone);
    if (!completed) {
      return res.status(403).json({ message: 'Complete onboarding before accessing the dashboard.' });
    }

    // Get workspace ID - prefer req.workspace._id if middleware ran, otherwise lookup
    let workspaceId = req.workspace?._id;
    if (!workspaceId) {
      // Fallback: get from header/query and convert wid to ObjectId
      const widOrId = req.headers['x-workspace-id'] || req.query.workspaceId || user.defaultWorkspace;
      if (!widOrId) {
        return res.status(403).json({ message: 'No workspace selected.' });
      }
      // If it looks like a wid string (ws_xxx), look up the actual _id
      if (typeof widOrId === 'string' && widOrId.startsWith('ws_')) {
        const workspace = await Workspace.findOne({ wid: widOrId }).select('_id').lean().exec();
        if (!workspace) {
          return res.status(403).json({ message: 'Workspace not found.' });
        }
        workspaceId = workspace._id;
      } else {
        workspaceId = widOrId;
      }
    }

    // Check workspace-specific onboarding detail completion
    const onboarding = await Onboarding.findOne({ user: id, workspace: workspaceId }).lean().exec();
    const detailCompleted = Boolean(onboarding?.onboardingDetailCompleted);
    if (!detailCompleted) {
      return res.status(403).json({ message: 'Complete onboarding before accessing the dashboard.' });
    }

    return next();
  } catch (_e) {
    return res.status(500).json({ message: 'Server error' });
  }
}
