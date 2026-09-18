-- CreateEnum
CREATE TYPE "NotePriority" AS ENUM ('HOCH', 'MITTEL', 'NIEDRIG');

-- CreateEnum
CREATE TYPE "NoteHorizon" AS ENUM ('HEUTE', 'DIESE_WOCHE', 'SPAETER');

-- CreateEnum
CREATE TYPE "NoteColour" AS ENUM ('WEISS', 'EIS', 'SAND', 'MINZE', 'HIMMEL');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('KUNDE', 'VERTRAG', 'SCHADEN');

-- CreateEnum
CREATE TYPE "WhiteboardRole" AS ENUM ('VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "NoteHistoryEventType" AS ENUM ('CREATED', 'MOVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whiteboards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Meine Wand',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whiteboard_members" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "userId" TEXT,
    "invitedEmail" TEXT,
    "role" "WhiteboardRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "whiteboard_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "WhiteboardRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "whiteboardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "priority" "NotePriority" NOT NULL DEFAULT 'MITTEL',
    "horizon" "NoteHorizon" NOT NULL DEFAULT 'HEUTE',
    "freeX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freeY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" DATE,
    "assigneeId" TEXT,
    "referenceType" "ReferenceType",
    "referenceLabel" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colour" "NoteColour" NOT NULL DEFAULT 'WEISS',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtasks" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortIndex" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subtasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_history_events" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "type" "NoteHistoryEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "note_history_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_options" (
    "id" TEXT NOT NULL,
    "type" "ReferenceType" NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "whiteboards_ownerId_key" ON "whiteboards"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "whiteboard_members_whiteboardId_userId_key" ON "whiteboard_members"("whiteboardId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "whiteboard_members_whiteboardId_invitedEmail_key" ON "whiteboard_members"("whiteboardId", "invitedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_whiteboardId_key" ON "share_links"("whiteboardId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "notes_whiteboardId_status_idx" ON "notes"("whiteboardId", "status");

-- CreateIndex
CREATE INDEX "notes_whiteboardId_horizon_idx" ON "notes"("whiteboardId", "horizon");

-- CreateIndex
CREATE INDEX "notes_whiteboardId_priority_idx" ON "notes"("whiteboardId", "priority");

-- CreateIndex
CREATE INDEX "notes_assigneeId_idx" ON "notes"("assigneeId");

-- CreateIndex
CREATE INDEX "note_history_events_noteId_idx" ON "note_history_events"("noteId");

-- CreateIndex
CREATE INDEX "reference_options_type_idx" ON "reference_options"("type");

-- CreateIndex
CREATE UNIQUE INDEX "reference_options_type_label_key" ON "reference_options"("type", "label");

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whiteboard_members" ADD CONSTRAINT "whiteboard_members_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whiteboard_members" ADD CONSTRAINT "whiteboard_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_history_events" ADD CONSTRAINT "note_history_events_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_history_events" ADD CONSTRAINT "note_history_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
