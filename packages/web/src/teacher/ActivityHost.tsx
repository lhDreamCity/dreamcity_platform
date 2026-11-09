/**
 * 插件宿主页 —— 驾驶舱的投屏区
 *
 * 关键设计（设计方案 §5）：
 *  - 活动永远不直连后端。结果通过 postMessage 交给宿主，由宿主落库
 *  - 断网时宿主把结果存本地队列，恢复后自动补传
 *  - 活动是独立单文件 HTML，零 CDN、零后端请求
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_RESULT_MESSAGE,
  HOST_INIT_MESSAGE,
  isActivityResultMessage,
  type ActivityResultMessage,
} from '@dreamcity/shared';
import { api } from '../lib/api';

const QUEUE_KEY = 'dc.resultQueue';

/** 本地结果队列：断网时先存着，恢复后补传 */
interface QueuedResult {
  sessionId: string;
  activityId: string;
  studentId: string | null;
  payload: Record<string, unknown>;
  visibility: string;
  ts: number;
}

function readQueue(): QueuedResult[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedResult[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedResult[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* 忽略 */
  }
}

async function flushQueue(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;
  const remaining: QueuedResult[] = [];
  let sent = 0;
  for (const item of queue) {
    try {
      await api(`/api/sessions/${item.sessionId}/results`, {
        method: 'POST',
        identity: 'staff',
        body: {
          activityId: item.activityId,
          studentId: item.studentId,
          payload: item.payload,
          visibility: item.visibility,
        },
      });
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
  return sent;
}

export interface ActivityHostProps {
  sessionId: string;
  activityId: string;
  /** 插件入口相对路径，如 lemon-stand.html */
  entry: string | null;
  studentId: string | null;
  studentNickname: string | null;
  level: string | null;
  /** 回传成功后的回调（讲师端用来刷新产出列表） */
  onResult?: (message: ActivityResultMessage) => void;
}

export function ActivityHost({
  sessionId,
  activityId,
  entry,
  studentId,
  studentNickname,
  level,
  onResult,
}: ActivityHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [queued, setQueued] = useState(readQueue().length);

  // 断网 → 恢复：补传本地队列
  useEffect(() => {
    const onOnline = async () => {
      setOffline(false);
      const n = await flushQueue();
      setQueued(readQueue().length);
      if (n > 0) window.dispatchEvent(new CustomEvent('dc:queue-flushed', { detail: n }));
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (!isActivityResultMessage(event.data)) return;
      const message = event.data;
      // 只接受本次 session 的回传
      if (message.sessionId !== sessionId) return;

      try {
        await api(`/api/sessions/${sessionId}/results`, {
          method: 'POST',
          identity: 'staff',
          body: {
            activityId: message.activityId,
            studentId: message.studentId,
            payload: message.payload,
            visibility: message.visibility,
          },
        });
        onResult?.(message);
      } catch {
        // 落库失败：存本地队列，恢复后补传
        const queue = readQueue();
        queue.push({
          sessionId,
          activityId: message.activityId,
          studentId: message.studentId,
          payload: message.payload,
          visibility: message.visibility,
          ts: message.ts,
        });
        writeQueue(queue);
        setQueued(queue.length);
      }
    },
    [sessionId, onResult],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // 插件加载完成后握手，注入 sessionId / studentId / level
  const sendInit = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: HOST_INIT_MESSAGE,
        sessionId,
        studentId,
        studentNickname,
        activityId,
        level,
        origin: window.location.origin,
      },
      '*',
    );
  }, [sessionId, studentId, studentNickname, activityId, level]);

  if (!entry) {
    return (
      <div className="empty" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        这个环节没有可拉起的活动
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <iframe
        ref={iframeRef}
        src={`/activities/${entry}`}
        title="课堂活动"
        onLoad={() => {
          setReady(true);
          sendInit();
        }}
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        sandbox="allow-scripts allow-same-origin"
      />
      {!ready && (
        <div className="empty" style={{ position: 'absolute', inset: 0 }}>
          正在准备活动…
        </div>
      )}
      {offline && (
        <div
          className="notice"
          style={{ position: 'absolute', left: 12, right: 12, bottom: 12, background: 'var(--warm)' }}
        >
          网络断了，活动照常可以玩 —— 结果会先存在本机，恢复后自动补传
        </div>
      )}
      {!offline && queued > 0 && (
        <div
          className="notice"
          style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}
        >
          有 {queued} 条结果等着补传，正在自动重试
        </div>
      )}
    </div>
  );
}
