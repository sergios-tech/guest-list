import { Box, Typography } from '@mui/material';
import { DndContext } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { PlanDetail } from '../../lib/seating';
import TableCircle from '../seating/TableCircle';

interface LayoutReportProps {
  plan: PlanDetail;
}

// Report 3: the graphical table placement, reusing the exact TableCircle the
// Seating canvas draws so the printout matches the editor. TableCircle is
// rendered read-only (no onEdit/onHoist/onUnseat → no edit button, no drag).
// The empty DndContext just satisfies @dnd-kit's useDroppable/useDraggable
// hooks inside TableCircle; with no sensors or handlers nothing is interactive.
export default function LayoutReport({ plan }: LayoutReportProps) {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t('print.layoutHeading')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('print.planLabel', { name: plan.name })}
      </Typography>

      <DndContext>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            alignContent: 'flex-start',
          }}
        >
          {plan.tables.map((table) => (
            <Box key={table.id} className="print-keep-together">
              <TableCircle table={table} totalTables={plan.tables.length} />
            </Box>
          ))}
        </Box>
      </DndContext>
    </Box>
  );
}
