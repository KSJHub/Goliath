import { useEffect, useState } from 'react';

import {
  joinGuildRoom,
  onSocketEvent,
} from '../services/socketClient';

const MAX_EVENTS = 100;

function addEvent(events, event) {
  return [event, ...events].slice(0, MAX_EVENTS);
}

export function useRealtimeTickets(guildId) {
  const [events, setEvents] = useState([]);
  const [lastTicketEvent, setLastTicketEvent] = useState(null);
  const [lastPanelEvent, setLastPanelEvent] = useState(null);
  const [lastTimelineEntry, setLastTimelineEntry] = useState(null);
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    if (!guildId) return undefined;

    joinGuildRoom(guildId);

    const handleTicketEvent = (event) => {
      setLastTicketEvent(event);
      setEvents((prev) => addEvent(prev, event));
    };

    const handlePanelEvent = (event) => {
      setLastPanelEvent(event);
      setEvents((prev) => addEvent(prev, event));
    };

    const unsubscribers = [
      onSocketEvent('ticket.created', handleTicketEvent),
      onSocketEvent('ticket.updated', handleTicketEvent),
      onSocketEvent('ticket.closed', handleTicketEvent),
      onSocketEvent('ticket.claimed', handleTicketEvent),
      onSocketEvent('ticket.reopened', handleTicketEvent),
      onSocketEvent('ticket.archived', handleTicketEvent),
      onSocketEvent('ticket.deleted', handleTicketEvent),

      onSocketEvent('ticket.timeline.entry', (event) => {
        setLastTimelineEntry(event);
        setEvents((prev) => addEvent(prev, event));
      }),

      onSocketEvent('panel.created', handlePanelEvent),
      onSocketEvent('panel.updated', handlePanelEvent),
      onSocketEvent('panel.deleted', handlePanelEvent),
      onSocketEvent('panel.deployed', handlePanelEvent),

      onSocketEvent('ticket.analytics.updated', (event) => {
        setAnalytics(event?.data || event);
        setEvents((prev) => addEvent(prev, event));
      }),

      onSocketEvent('goliath_realtime_event', (event) => {
        setEvents((prev) => addEvent(prev, event));
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [guildId]);

  const latestEvent = events[0] || null;
  const stats = {
    totalEvents: events.length,
    hasEvents: events.length > 0,
    latestEvent,
  };

  return {
    events,
    latestEvent,
    stats,

    lastTicketEvent,
    lastPanelEvent,
    lastTimelineEntry,
    analytics,
  };
}

export default useRealtimeTickets;
