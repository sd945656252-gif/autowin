type WorkflowRealtimeHandlers = {
  onMessage?: (message: any) => void;
  onPresence?: (users: Array<{ userId: string; displayName: string }>) => void;
  onConflict?: (currentRevision: number | null) => void;
};

export function connectWorkflowRealtime(workflowId: string, handlers: WorkflowRealtimeHandlers = {}) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join-workflow', workflowId }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'presence') handlers.onPresence?.(message.users || []);
    if (message.type === 'revision-conflict') handlers.onConflict?.(message.currentRevision ?? null);
    handlers.onMessage?.(message);
  });

  return {
    socket,
    sendCanvasEvent(payload: Record<string, any>) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'canvas-event', ...payload }));
    },
    saveRevision(revision: number) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'save-revision', workflowId, revision }));
    },
    close() {
      socket.close();
    }
  };
}
