import { createContext } from 'react';

/**
 * True while the current drag is an Alt/Option copy. The source card then stays where it
 * is, and the overlay wears a "+" badge so it reads as a copy being placed rather than the
 * note itself moving. A context rather than a prop: only the board's DndContext knows, and
 * the cards sit two components below it.
 */
export const CopyDragContext = createContext(false);
