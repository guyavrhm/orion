/**
 * Lightweight application event bus to decouple components and services
 * without polluting the global window object.
 */
class EventBus {
  constructor() {
    this.listeners = {};
  }

  /**
   * Register a listener callback for an event.
   * Returns a function to unsubscribe.
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove a listener callback for an event.
   */
  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  /**
   * Publish an event, notifying all subscribers.
   */
  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[EventBus] Callback execution failed for event "${event}":`, err);
      }
    });
  }
}

const eventBus = new EventBus();
export default eventBus;
export { eventBus };
