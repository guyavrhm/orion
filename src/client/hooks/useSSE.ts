import { useEffect, useState, useCallback, useRef } from 'react';
import type { UserActiveMediaState, UserMediaRequestStatus } from '../../main/types/index.js';
import { ApiClient } from '../services/api.js';

interface SSEStatusPayload {
  id: string;
  status: UserMediaRequestStatus;
  progress: string;
  error?: string;
  stage?: string;
}

export function useSSE() {
  const [activeRequests, setActiveRequests] = useState<Record<string, UserActiveMediaState>>({});
  const [connected, setConnected] = useState<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial queue fetch
  const refreshQueue = useCallback(async () => {
    try {
      const res = await ApiClient.getQueue();
      if (res && res.activeMediaRequests) {
        setActiveRequests(res.activeMediaRequests);
      }
    } catch {
      // Ignore initial load network error
    }
  }, []);

  useEffect(() => {
    refreshQueue();

    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      const es = new EventSource('/events');
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          if (!event.data || event.data.startsWith(':')) return;
          const parsed = JSON.parse(event.data);
          
          if (parsed.channel === 'media-request-status' && parsed.data) {
            const data = parsed.data as SSEStatusPayload;
            setActiveRequests((prev) => {
              // If status is removed or ready, we can update or keep state
              if (data.status === 'removed') {
                const next = { ...prev };
                delete next[data.id];
                return next;
              }

              return {
                ...prev,
                [data.id]: {
                  fileId: data.id,
                  status: data.status,
                  progress: data.progress,
                  error: data.error,
                },
              };
            });
          }
        } catch {
          // Ignore parsing error
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Retry connect after 3 seconds
        retryTimeout = setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [refreshQueue]);

  return { activeRequests, connected, refreshQueue, setActiveRequests };
}
