// In-app notifications (earlier project's NotificationsPage). The phone turns `kind` into Tamil or English text.

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

// Only the owner's notifications change; ids belonging to someone else are ignored
export function markRead(db, farmer, ids) {
  if (Array.isArray(ids) && ids.length) {
    const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE farmer = ? AND id = ?');
    for (const id of ids.slice(0, 200)) stmt.run(farmer, Number(id));
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE farmer = ?').run(farmer);
  }
  return notificationsOf(db, farmer).unread;
}
