import express from 'express';
import { z } from 'zod';

const app = express();
const port = 4001;

// Mock database for subscriptions
const subscriptions = new Map<string, { active: boolean, tier: 'pro' | 'enterprise' }>();
subscriptions.set('test-key-123', { active: true, tier: 'pro' });

app.use(express.json());

const AuthSchema = z.object({
  apiKey: z.string()
});

app.post('/v1/auth/validate', (req, res) => {
  try {
    const { apiKey } = AuthSchema.parse(req.body);
    const sub = subscriptions.get(apiKey);

    if (sub && sub.active) {
      return res.json({ valid: true, tier: sub.tier });
    }
    
    res.status(401).json({ valid: false, error: 'Invalid or expired subscription' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

app.listen(port, () => {
  console.log(`💳 Subscription Gate active on http://localhost:${port}`);
});
