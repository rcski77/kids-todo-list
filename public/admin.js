async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.status === 204 ? null : res.json();
}

async function loadKids() {
  const kids = await api('/kids');
  const el = document.getElementById('kidsList');
  el.innerHTML = '';
  for (const kid of kids) {
    const tasks = await api(`/kids/${kid.id}/tasks`);
    const block = document.createElement('div');
    block.className = 'kid-block';
    block.innerHTML = `
      <div class="kid-title">
        <span>${kid.emoji} ${kid.name}
          <span class="esp-url">GET /api/kids/${kid.id}/display</span>
        </span>
        <button class="danger" data-delete-kid="${kid.id}">Delete kid</button>
      </div>
      <table>
        <thead><tr><th>#</th><th>Emoji</th><th>Name</th><th>Detail</th><th>Timer</th><th></th></tr></thead>
        <tbody>
          ${tasks
            .map(
              (t, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${t.emoji}</td>
              <td>${t.name}</td>
              <td>${t.detail}</td>
              <td>${t.has_timer ? t.timer_seconds + 's' : '—'}</td>
              <td><button class="danger" data-delete-task="${t.id}">✕</button></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <form class="inline" data-add-task="${kid.id}">
        <input name="emoji" placeholder="Emoji" value="⭐" style="width:50px" maxlength="4">
        <input name="name" placeholder="Task name" required>
        <input name="detail" placeholder="Detail (optional)">
        <label style="font-size:0.8rem"><input type="checkbox" name="hasTimer"> has timer</label>
        <input name="timerSeconds" type="number" placeholder="secs" value="120" style="width:70px">
        <button type="submit">Add task</button>
      </form>
    `;
    el.appendChild(block);
  }

  el.querySelectorAll('[data-delete-kid]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this kid and all their tasks/progress?')) return;
      await api(`/kids/${btn.dataset.deleteKid}`, { method: 'DELETE' });
      loadKids();
    };
  });
  el.querySelectorAll('[data-delete-task]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/tasks/${btn.dataset.deleteTask}`, { method: 'DELETE' });
      loadKids();
    };
  });
  el.querySelectorAll('[data-add-task]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api(`/kids/${form.dataset.addTask}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          emoji: fd.get('emoji'),
          name: fd.get('name'),
          detail: fd.get('detail'),
          hasTimer: fd.get('hasTimer') === 'on',
          timerSeconds: Number(fd.get('timerSeconds')) || 120,
        }),
      });
      loadKids();
    };
  });
}

document.getElementById('addKidForm').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api('/kids', {
    method: 'POST',
    body: JSON.stringify({
      name: fd.get('name'),
      emoji: fd.get('emoji'),
      color: fd.get('color'),
    }),
  });
  e.target.reset();
  e.target.querySelector('[name=emoji]').value = '🧒';
  loadKids();
};

loadKids();
