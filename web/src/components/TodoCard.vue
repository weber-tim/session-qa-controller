<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { formatAge } from "../format";
import type { Todo, TodoLane } from "../types";

const props = defineProps<{ todo: Todo; now: number; dragging: boolean }>();
const emit = defineEmits<{ remove: []; setLane: [lane: TodoLane]; setText: [text: string]; setNote: [note: string]; removeNote: []; setLink: [link: string]; removeLink: [] }>();

// Same spine-colour convention as Strip.vue: the lane's colour, except "landed" uses the
// muted LANDED_COLOR (#2f6f4f) rather than the brighter #4cc38a used for the header badge
// — a landed CARD reads the same subdued way a landed SESSION strip does.
const SPINE: Record<TodoLane, string> = {
  open: "var(--gray)",
  inflight: "var(--green)",
  holding: "var(--amber)",
  landed: "#2f6f4f",
};
const spineColor = computed(() => SPINE[props.todo.lane]);
// same slot as Strip's bottom-right .age — time since the card was created
const age = computed(() => formatAge(props.now - props.todo.createdAt));

// Allowed manual FORWARD transitions, per the user's table — "open" is never a button
// target here; the only way back to it is the Landed badge's undo-× below, mirroring
// Strip.vue exactly: "land" is the one forward action button, "unland" is a dedicated
// undo on the Landed badge itself, not a generic "move to any lane" control.
const NEXT: Record<TodoLane, { lane: TodoLane; label: string; icon: string }[]> = {
  open: [
    { lane: "inflight", label: "flight", icon: "ti-plane-inflight" },
    { lane: "landed", label: "landed", icon: "ti-plane-arrival" },
  ],
  inflight: [
    { lane: "holding", label: "hold", icon: "ti-circle-filled" },
    { lane: "landed", label: "landed", icon: "ti-plane-arrival" },
  ],
  holding: [
    { lane: "inflight", label: "flight", icon: "ti-plane-inflight" },
    { lane: "landed", label: "landed", icon: "ti-plane-arrival" },
  ],
  landed: [],
};
const targets = computed(() => NEXT[props.todo.lane]);

// title editing — double-click to rename, same commit/cancel flow as note/link
const editingTitle = ref(false);
const titleDraft = ref("");
const titleInputEl = ref<HTMLInputElement | null>(null);
async function openTitleEdit() {
  editingTitle.value = true;
  titleDraft.value = props.todo.text;
  await nextTick();
  titleInputEl.value?.focus();
  titleInputEl.value?.select();
}
function commitTitle() {
  const v = titleDraft.value.trim();
  editingTitle.value = false;
  if (v && v !== props.todo.text) emit("setText", v);
}

// note editing — identical flow to Strip.vue's openNote/commitNote
const editing = ref(false);
const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
async function openNote() {
  editing.value = true;
  draft.value = props.todo.note ?? "";
  await nextTick();
  inputEl.value?.focus();
}
function commitNote() {
  const v = draft.value.trim();
  editing.value = false;
  if (v) emit("setNote", v);
}

// link editing — same flow, plus a bit of host-sniffing so the chip reads as "Jira" /
// "Confluence" / "Slack" rather than a raw URL
const editingLink = ref(false);
const linkDraft = ref("");
const linkInputEl = ref<HTMLInputElement | null>(null);
async function openLink() {
  editingLink.value = true;
  linkDraft.value = props.todo.link ?? "";
  await nextTick();
  linkInputEl.value?.focus();
}
function commitLink() {
  const v = linkDraft.value.trim();
  editingLink.value = false;
  if (v) emit("setLink", v);
}
const linkMeta = computed(() => {
  const url = props.todo.link;
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("slack.com")) return { icon: "ti-brand-slack", label: "Slack" };
    if (u.hostname.endsWith("atlassian.net") && u.pathname.startsWith("/wiki/")) return { icon: "ti-notebook", label: "Confluence" };
    if (u.hostname.endsWith("atlassian.net")) return { icon: "ti-ticket", label: "Jira" };
    return { icon: "ti-link", label: u.hostname.replace(/^www\./, "") };
  } catch {
    return { icon: "ti-link", label: "Link" };
  }
});
</script>

<template>
  <div class="todo-card" :class="{ dragging, landed: todo.lane === 'landed' }">
    <div class="spine" :style="{ background: spineColor }"></div>
    <div class="body">
      <div class="cs">
        <span v-if="!editingTitle" class="text" title="Doppelklick zum Umbenennen" @dblclick="openTitleEdit">{{ todo.text }}</span>
        <input
          v-else
          ref="titleInputEl"
          v-model="titleDraft"
          class="title-input"
          @keydown.enter="commitTitle"
          @keydown.esc="editingTitle = false"
          @blur="commitTitle"
        />
        <span v-if="todo.lane === 'landed'" class="badge">
          <i class="ti ti-check"></i> Landed
          <button class="badge-x" aria-label="zurück nach Taxiing" title="zurück nach Taxiing" @click="emit('setLane', 'open')"><i class="ti ti-x"></i></button>
        </span>
        <button class="icon" aria-label="löschen" @click="emit('remove')"><i class="ti ti-x"></i></button>
      </div>

      <div class="meta">
        <span v-if="todo.note && !editing" class="note">
          <i class="ti ti-pin"></i>
          <span>{{ todo.note }}</span>
          <button class="icon" aria-label="Notiz entfernen" @click="emit('removeNote')"><i class="ti ti-x"></i></button>
        </span>
        <input
          v-if="editing"
          ref="inputEl"
          v-model="draft"
          class="note-input"
          placeholder="Notiz… z.B. wartet auf Anna"
          @keydown.enter="commitNote"
          @keydown.esc="editing = false"
          @blur="commitNote"
        />
        <button v-if="!todo.note && !editing" class="ghost" @click="openNote"><i class="ti ti-plus"></i> note</button>

        <a v-if="todo.link && linkMeta && !editingLink" class="link-chip" :href="todo.link" target="_blank" rel="noreferrer" :title="todo.link">
          <i class="ti" :class="linkMeta.icon"></i>{{ linkMeta.label }}
          <button class="badge-x" aria-label="Link entfernen" @click.prevent="emit('removeLink')"><i class="ti ti-x"></i></button>
        </a>
        <input
          v-if="editingLink"
          ref="linkInputEl"
          v-model="linkDraft"
          class="note-input"
          placeholder="https://…"
          @keydown.enter="commitLink"
          @keydown.esc="editingLink = false"
          @blur="commitLink"
        />
        <button v-if="!todo.link && !editingLink" class="ghost" @click="openLink"><i class="ti ti-plus"></i> link</button>
      </div>

      <!-- pinned to the bottom of the card (margin-top: auto) regardless of how much
           note/link content sits above, so it lands in the same spot on every card -->
      <div class="status-row">
        <button v-for="tgt in targets" :key="tgt.lane" class="ghost" @click="emit('setLane', tgt.lane)">
          <i class="ti" :class="tgt.icon"></i> {{ tgt.label }}
        </button>
        <span class="age" :style="{ color: spineColor }">{{ age }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-card { display: flex; background: var(--strip); border: 0.5px solid var(--border); border-radius: 8px; overflow: hidden; cursor: grab; width: 100%; transition: background-color 0.12s ease; }
.todo-card:hover { background-image: linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05)); }
.todo-card.dragging { opacity: 0.4; }
.todo-card.landed { opacity: 0.9; }
.spine { width: 4px; flex: none; }
.body { flex: 1; min-width: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.cs { display: flex; align-items: center; gap: 6px; flex: none; }
.text { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-hi); line-height: 1.4; word-break: break-word; cursor: text; }
.title-input { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; height: 24px; padding: 1px 6px; }
/* identical to Strip.vue's Landed badge */
.badge { font-size: 10px; padding: 1px 6px; border-radius: 6px; white-space: nowrap; flex: none; display: inline-flex; align-items: center; gap: 3px; background: #16301f; color: #4cc38a; }
.badge-x { all: unset; cursor: pointer; display: inline-flex; margin-left: 3px; opacity: 0.7; }
.badge-x:hover { opacity: 1; }
.icon { all: unset; cursor: pointer; display: inline-flex; align-items: center; padding: 2px; margin-left: 2px; border-radius: 4px; font-size: 13px; color: var(--text-faint); opacity: 0; transition: opacity 0.1s; flex: none; }
.todo-card:hover .icon { opacity: 1; }
.icon:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-dim); }
/* note/link row — right under the title */
.meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.note { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; background: var(--parked-bg); color: var(--parked); border-radius: 6px; padding: 2px 4px 2px 7px; }
/* same shape as Strip.vue's .pr pill */
.link-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--blue); border: 0.5px solid color-mix(in srgb, var(--blue) 40%, transparent); border-radius: 6px; padding: 1px 4px 1px 7px; text-decoration: none; }
.link-chip:hover { border-color: var(--blue); }
.note-input { font-size: 11px; height: 26px; width: 100%; }
.ghost { font-size: 11px; color: var(--text-faint); border: 0.5px dashed var(--border); border-radius: 6px; padding: 1px 7px; background: transparent; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.ghost:hover { color: var(--text-dim); border-color: var(--gray); }
/* status buttons + age — pinned to the card's bottom edge */
.status-row { margin-top: auto; flex: none; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding-top: 4px; }
.status-row .age { margin-left: auto; font-size: 11px; font-weight: 500; }
</style>
