// In-app notifications (earlier project's NotificationsPage). The phone turns `kind` into Tamil or English text.
import { ApiError } from './errors.js';

export function notify(db, recipients, kind, poolId, actorName, at) {
  const stmt = db.prepare('INSERT INTO notifications (farmer, kind, pool_id, actor_name, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const farmer of new Set(recipients)) stmt.run(farmer, kind, poolId, actorName ?? null, at);
}

export function notificationsOf(db, farmer) {
  const items = db.prepare('SELECT * FROM notifications WHERE farmer = ? ORDER BY id DESC LIMIT 50').all(farmer)
    .map(n => ({ id: n.id, kind: n.kind, poolId: n.pool_id, actorName: n.actor_name, createdAt: n.created_at, read: n.read === 1 }));
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE farmer = ? AND read = 0').get(farmer).n;
  return { items, unread };
}

// No ids: mark all read. A list (possibly empty): only those. Only the owner's notifications change.
export function markRead(db, farmer, ids) {
  if (ids === undefined) {
    db.prepare('UPDATE notifications SET read = 1 WHERE farmer = ?').run(farmer);
  } else {
    if (!Array.isArray(ids)) throw new ApiError(400, 'bad_ids', 'ids must be a list of notification ids');
    const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE farmer = ? AND id = ?');
    for (const id of ids.slice(0, 200)) stmt.run(farmer, Number(id));
  }
  return notificationsOf(db, farmer).unread;
}
