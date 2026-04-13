const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');

// M8: Fleet — not implemented (out of scope)
router.all('*', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M8' });
});

module.exports = router;
