const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({ userId: req.userId });
});

module.exports = router;
