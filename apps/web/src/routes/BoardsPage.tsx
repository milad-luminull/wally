import { HomeShell } from '@/features/boards/HomeShell';
import { BoardHome } from '@/features/boards/BoardHome';

/** `/boards`: the board home. Never redirects (RFC BOARD_HOME §6). */
export function BoardsPage() {
  return (
    <HomeShell>
      <BoardHome />
    </HomeShell>
  );
}
