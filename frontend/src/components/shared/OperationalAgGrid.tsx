import React, { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { normalizeOperationalColumnDefinitions } from './OperationalGridSizing'

export const OperationalAgGrid = React.forwardRef<any, any>(({ columnDefs, ...props }, ref) => {
  const normalizedColumnDefs = useMemo(
    () => normalizeOperationalColumnDefinitions(columnDefs),
    [columnDefs],
  )

  return <AgGridReact {...props} columnDefs={normalizedColumnDefs} ref={ref} />
})

OperationalAgGrid.displayName = 'OperationalAgGrid'
