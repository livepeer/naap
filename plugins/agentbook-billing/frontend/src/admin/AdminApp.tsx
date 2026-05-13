import { useState } from 'react';
import { PlanList } from './PlanList';
import { TemplatePickerModal } from './TemplatePickerModal';
import { PlanEditorModal } from './PlanEditorModal';
import type { Plan, PlanTemplate } from '../lib/api';

type Modal =
  | null
  | { kind: 'picker' }
  | { kind: 'edit'; plan: Plan }
  | { kind: 'create'; template: PlanTemplate };

export function AdminApp(): JSX.Element {
  const [modal, setModal] = useState<Modal>(null);
  const [refresh, setRefresh] = useState(0);

  return (
    <div>
      <PlanList
        key={refresh}
        onAdd={() => setModal({ kind: 'picker' })}
        onEdit={(plan) => setModal({ kind: 'edit', plan })}
      />
      {modal?.kind === 'picker' && (
        <TemplatePickerModal
          onClose={() => setModal(null)}
          onPicked={(t) => setModal({ kind: 'create', template: t })}
        />
      )}
      {modal?.kind === 'create' && (
        <PlanEditorModal
          mode={{ kind: 'create', template: modal.template }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setRefresh((r) => r + 1); }}
        />
      )}
      {modal?.kind === 'edit' && (
        <PlanEditorModal
          mode={{ kind: 'edit', plan: modal.plan }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setRefresh((r) => r + 1); }}
        />
      )}
    </div>
  );
}
