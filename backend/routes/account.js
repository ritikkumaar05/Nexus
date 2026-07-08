const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { validateInput, schemas } = require('../middleware/validateInput');
const { asyncHandler } = require('../utils/AppError');
const AccountService = require('../services/AccountService');

router.use(authenticateToken);

router.get('/security', asyncHandler(async (req, res) => {
  const overview = await AccountService.getSecurityOverview(req.user.id, req.user.sessionId);
  res.json(overview);
}));

router.get('/security/sessions', asyncHandler(async (req, res) => {
  const overview = await AccountService.getSecuritySessions(req.user.id, req.user.sessionId);
  res.json(overview);
}));

router.get('/security/activity', asyncHandler(async (req, res) => {
  const overview = await AccountService.getSecurityActivity(req.user.id);
  res.json(overview);
}));

router.post(
  '/set-password',
  validateInput(schemas.setPassword),
  asyncHandler(async (req, res) => {
    const result = await AccountService.setPassword(req.user.id, req.body.password, req.user.sessionId);
    res.json(result);
  })
);

router.post(
  '/change-password',
  validateInput(schemas.changePassword),
  asyncHandler(async (req, res) => {
    const result = await AccountService.changePassword(
      req.user.id,
      req.body.currentPassword,
      req.body.newPassword,
      req.user.sessionId
    );
    res.json(result);
  })
);

router.post(
  '/delete/request',
  validateInput(schemas.requestAccountDelete),
  asyncHandler(async (req, res) => {
    const result = await AccountService.requestAccountDeletion(req.user.id, req.body);
    res.json(result);
  })
);

router.post(
  '/delete/confirm',
  validateInput(schemas.confirmAccountDelete),
  asyncHandler(async (req, res) => {
    const result = await AccountService.confirmAccountDeletion(req.user.id, req.body);
    res.json(result);
  })
);

module.exports = router;
