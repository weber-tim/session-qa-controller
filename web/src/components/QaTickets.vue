<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { formatAge } from "../format";
import { useEscClose } from "../useEscClose";
import type { JiraPollStatus, JiraTicket, JiraView } from "../types";

const props = defineProps<{ tickets: JiraTicket[]; status: JiraPollStatus | null; now: number }>();
const emit = defineEmits<{ close: [] }>();
useEscClose(() => emit("close"));

const jql = ref("");
const views = ref<JiraView[]>([]);
const selectedViewId = ref("");
const loading = ref(true);

onMounted(async () => {
  try {
    const [cfgRes, viewsRes] = await Promise.all([fetch("/api/jira/config"), fetch("/api/jira/views")]);
    jql.value = ((await cfgRes.json()) as { jql?: string }).jql ?? "";
    views.value = (await viewsRes.json()) as JiraView[];
    selectedViewId.value = views.value.find((v) => v.jql === jql.value)?.id ?? "";
  } catch {
    /* leave defaults */
  } finally {
    loading.value = false;
  }
});

// editing the JQL by hand no longer matches whichever view was selected — drop the
// selection rather than have the dropdown keep showing a name for a query it doesn't match
watch(jql, (q) => {
  const v = views.value.find((x) => x.id === selectedViewId.value);
  if (v && v.jql !== q) selectedViewId.value = "";
});

async function run() {
  await fetch("/api/jira/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jql: jql.value.trim() }),
  });
}

function onSelectView() {
  const v = views.value.find((x) => x.id === selectedViewId.value);
  if (!v) return;
  jql.value = v.jql;
  run();
}

async function saveView() {
  const q = jql.value.trim();
  if (!q) return;
  const name = prompt("Name für diese Ansicht?");
  if (!name?.trim()) return;
  const res = await fetch("/api/jira/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), jql: q }),
  });
  if (!res.ok) return;
  const view = (await res.json()) as JiraView;
  views.value = [view, ...views.value];
  selectedViewId.value = view.id;
}

async function deleteSelectedView() {
  if (!selectedViewId.value) return;
  await fetch(`/api/jira/views/${selectedViewId.value}`, { method: "DELETE" });
  views.value = views.value.filter((v) => v.id !== selectedViewId.value);
  selectedViewId.value = "";
}

const age = (t: JiraTicket) => formatAge(props.now - t.updatedAt);
// "checked Xs ago" — every poll (background timer or a manual "Suchen") updates this
const checkedAgo = computed(() => (props.status?.checkedAt ? formatAge(props.now - props.status.checkedAt) : null));
</script>

<template>
  <Teleport to="body">
    <div class="qa-overlay" @click.self="emit('close')">
      <div class="qa-panel">
        <div class="qa-h">
          <span><i class="ti ti-bug"></i> Jira-Tickets</span>
          <span v-if="checkedAgo" class="qa-checked">zuletzt geprüft vor {{ checkedAgo }}</span>
          <button class="icon" aria-label="close" @click="emit('close')"><i class="ti ti-x"></i></button>
        </div>

        <div class="qa-toolbar">
          <div class="qa-select-wrap">
            <select v-model="selectedViewId" class="qa-select" @change="onSelectView">
              <option value="">eigene JQL…</option>
              <option v-for="v in views" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
            <i class="ti ti-chevron-down qa-select-caret"></i>
          </div>
          <input
            v-model="jql"
            class="qa-jql mono"
            placeholder='JQL, z.B. project = APP AND status = &quot;Ready for QA&quot;'
            spellcheck="false"
            @keydown.enter="run"
          />
          <button class="ghost" title="jetzt ausführen" @click="run"><i class="ti ti-player-play"></i> Suchen</button>
          <button class="ghost" title="aktuelle JQL als Ansicht speichern" @click="saveView"><i class="ti ti-device-floppy"></i> Speichern</button>
          <button v-if="selectedViewId" class="ghost" title="Ansicht löschen" @click="deleteSelectedView"><i class="ti ti-trash"></i></button>
        </div>

        <div v-if="status && !status.ok" class="qa-error">
          <i class="ti ti-alert-triangle"></i> {{ status.error }}
        </div>

        <div class="qa-body">
          <div v-if="loading" class="qa-empty">lädt…</div>
          <div v-else-if="!jql.trim()" class="qa-empty">Noch keine JQL hinterlegt. Zugangsdaten unter <b>Settings → Jira</b> einrichten, dann hier eine Abfrage eintragen.</div>
          <div v-else-if="!tickets.length" class="qa-empty">Keine Treffer für diese Abfrage.</div>
          <div v-else class="qa-list">
            <a v-for="t in tickets" :key="t.key" class="qa-row" :href="t.url" target="_blank" rel="noreferrer">
              <span class="qa-key mono">{{ t.key }}</span>
              <span class="qa-summary">{{ t.summary }}</span>
              <span class="qa-assignee">{{ t.assignee ?? "—" }}</span>
              <span class="qa-status">{{ t.status }}</span>
              <span class="qa-age">{{ age(t) }}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.qa-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(6, 9, 13, 0.66); display: flex; align-items: center; justify-content: center; padding: 32px; }
.qa-panel { width: min(920px, 94vw); max-height: 82vh; display: flex; flex-direction: column; background: var(--panel); border: 0.5px solid var(--border); border-radius: 12px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5); overflow: hidden; }
.qa-h { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 0.5px solid var(--border-soft); font-size: 13px; font-weight: 500; color: var(--text); }
.qa-checked { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--text-faint); }
.qa-h .icon { all: unset; cursor: pointer; display: inline-flex; padding: 4px; border-radius: 6px; color: var(--text-faint); font-size: 15px; }
.qa-h .icon:hover { background: rgba(255, 255, 255, 0.08); color: var(--text-dim); }

.qa-toolbar { flex: none; display: flex; gap: 6px; padding: 10px 14px; border-bottom: 0.5px solid var(--border-soft); }
.qa-select-wrap { position: relative; flex: none; }
.qa-select {
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  background: var(--bg); color: var(--text); border: 0.5px solid var(--border); border-radius: 6px;
  font-size: 12px; max-width: 160px; padding: 6px 24px 6px 8px; cursor: pointer;
}
.qa-select:focus { outline: none; border-color: var(--amber); }
.qa-select option { background: var(--bg); color: var(--text); }
.qa-select-caret { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); font-size: 11px; color: var(--text-faint); pointer-events: none; }
.qa-jql { flex: 1; min-width: 0; font-size: 12px; padding: 6px 9px; }
.ghost { font-size: 11.5px; color: var(--text-faint); border: 0.5px dashed var(--border); border-radius: 6px; padding: 5px 10px; background: transparent; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
.ghost:hover { color: var(--text-dim); border-color: var(--gray); }

.qa-error { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 12px; color: var(--red); border-bottom: 0.5px solid var(--border-soft); background: rgba(248, 81, 73, 0.08); }
.qa-body { flex: 1; min-height: 0; overflow-y: auto; }
.qa-empty { padding: 20px 14px; font-size: 12px; line-height: 1.6; color: var(--text-faint); }
.qa-list { display: flex; flex-direction: column; padding: 6px; }
.qa-row { display: grid; grid-template-columns: 90px 1fr 140px 120px 56px; align-items: center; gap: 10px; padding: 8px 8px; border-radius: 8px; text-decoration: none; color: var(--text); }
.qa-row:hover { background: rgba(255, 255, 255, 0.03); }
.qa-key { font-size: 11px; color: var(--blue); white-space: nowrap; }
.qa-summary { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qa-assignee { font-size: 11.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qa-status { font-size: 10.5px; background: var(--chip); color: var(--text-dim); border-radius: 6px; padding: 2px 7px; white-space: nowrap; text-align: center; }
.qa-age { font-size: 11px; color: var(--text-faint); white-space: nowrap; text-align: right; }
@media (max-width: 700px) { .qa-row { grid-template-columns: 1fr; gap: 2px; } }
</style>
