import type { Response } from 'express';

interface Client {
  res: Response;
}

export class Hub {
  private readonly clients = new Map<string, Set<Client>>();

  add(userId: string, res: Response): Client {
    const client: Client = { res };
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(client);
    return client;
  }

  remove(userId: string, client: Client): void {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.clients.delete(userId);
  }

  send(userId: string, data: unknown): void {
    const set = this.clients.get(userId);
    if (!set) return;
    const line = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of set) {
      try {
        client.res.write(line);
      } catch {
        set.delete(client);
      }
    }
  }

  count(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }
}
