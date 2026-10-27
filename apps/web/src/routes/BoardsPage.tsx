import { HomeShell } from '@/features/boards/HomeShell';
import { BoardHome } from '@/features/boards/BoardHome';

/** `/boards`: the board home. Never redirects (RFC-0002 §6). */
export function BoardsPage() {
  return (
    <HomeShell>
      <BoardHome />
    </HomeShell>
  );
}
