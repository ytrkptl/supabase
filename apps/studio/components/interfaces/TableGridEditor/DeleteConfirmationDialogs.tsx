import Link from 'next/link'
import toast from 'react-hot-toast'
import { Alert, Button, Checkbox, IconExternalLink, Modal } from 'ui'

import { SupaRow } from 'components/grid'
import { formatFilterURLParams } from 'components/grid/SupabaseGrid.utils'
import { useProjectContext } from 'components/layouts/ProjectLayout/ProjectContext'
import ConfirmationModal from 'components/ui/ConfirmationModal'
import { useDatabaseColumnDeleteMutation } from 'data/database-columns/database-column-delete-mutation'
import { useTableRowDeleteAllMutation } from 'data/table-rows/table-row-delete-all-mutation'
import { useTableRowDeleteMutation } from 'data/table-rows/table-row-delete-mutation'
import { useTableRowTruncateMutation } from 'data/table-rows/table-row-truncate-mutation'
import { useTableDeleteMutation } from 'data/tables/table-delete-mutation'
import { useGetTables } from 'data/tables/tables-query'
import { useUrlState } from 'hooks'
import { TableLike } from 'hooks/misc/useTable'
import { noop } from 'lib/void'
import { useGetImpersonatedRole } from 'state/role-impersonation-state'
import { useTableEditorStateSnapshot } from 'state/table-editor'
import { tableKeys } from 'data/tables/keys'

export type DeleteConfirmationDialogsProps = {
  projectRef?: string
  selectedTable?: TableLike
  includeColumns?: boolean
  onAfterDeleteTable?: (tables: TableLike[]) => void
}

const DeleteConfirmationDialogs = ({
  projectRef,
  selectedTable,
  includeColumns = false,
  onAfterDeleteTable = noop,
}: DeleteConfirmationDialogsProps) => {
  const { project } = useProjectContext()
  const snap = useTableEditorStateSnapshot()

  const [{ filter }, setParams] = useUrlState({ arrayKeys: ['filter', 'sort'] })
  const filters = formatFilterURLParams(filter as string[])

  const getTables = useGetTables({
    projectRef: project?.ref,
    connectionString: project?.connectionString,
  })

  const removeDeletedColumnFromFiltersAndSorts = (columnName: string) => {
    setParams((prevParams) => {
      const existingFilters = (prevParams?.filter ?? []) as string[]
      const existingSorts = (prevParams?.sort ?? []) as string[]

      return {
        ...prevParams,
        filter: existingFilters.filter((filter: string) => {
          const [column] = filter.split(':')
          if (column !== columnName) return filter
        }),
        sort: existingSorts.filter((sort: string) => {
          const [column] = sort.split(':')
          if (column !== columnName) return sort
        }),
      }
    })
  }

  const { mutate: deleteColumn } = useDatabaseColumnDeleteMutation({
    onSuccess: () => {
      if (!(snap.confirmationDialog?.type === 'column')) return
      const selectedColumnToDelete = snap.confirmationDialog.column
      removeDeletedColumnFromFiltersAndSorts(selectedColumnToDelete.name)
      toast.success(`Successfully deleted column "${selectedColumnToDelete.name}"`)
    },
    onError: (error) => {
      if (!(snap.confirmationDialog?.type === 'column')) return
      const selectedColumnToDelete = snap.confirmationDialog.column
      toast.error(`Failed to delete ${selectedColumnToDelete!.name}: ${error.message}`)
    },
    onSettled: () => {
      snap.closeConfirmationDialog()
    },
  })
  const { mutateAsync: deleteTable } = useTableDeleteMutation({
    onSuccess: async () => {
      const tables = await getTables(snap.selectedSchemaName)
      onAfterDeleteTable(tables)
      toast.success(`Successfully deleted table "${selectedTable?.name}"`)
    },
    onError: (error) => {
      toast.error(`Failed to delete ${selectedTable?.name}: ${error.message}`)
    },
    onSettled: () => {
      snap.closeConfirmationDialog()
    },
  })

  const { mutate: deleteRows } = useTableRowDeleteMutation({
    onSuccess: () => {
      if (snap.confirmationDialog?.type === 'row') {
        snap.confirmationDialog.callback?.()
      }
      toast.success(`Successfully deleted selected row(s)`)
    },
    onError: (error) => {
      toast.error(`Failed to delete row: ${error.message}`)
    },
    onSettled: () => {
      snap.closeConfirmationDialog()
    },
  })

  const { mutateAsync: deleteAllRows } = useTableRowDeleteAllMutation({
    onSuccess: () => {
      if (snap.confirmationDialog?.type === 'row') {
        snap.confirmationDialog.callback?.()
      }
      toast.success(`Successfully deleted selected rows`)
    },
    onError: (error) => {
      toast.error(`Failed to delete rows: ${error.message}`)
    },
    onSettled: () => {
      snap.closeConfirmationDialog()
    },
  })

  const { mutateAsync: truncateRows } = useTableRowTruncateMutation({
    onSuccess: () => {
      if (snap.confirmationDialog?.type === 'row') {
        snap.confirmationDialog.callback?.()
      }
      toast.success(`Successfully deleted all rows from table`)
    },
    onError: (error) => {
      toast.error(`Failed to delete rows: ${error.message}`)
    },
    onSettled: () => {
      snap.closeConfirmationDialog()
    },
  })

  const isAllRowsSelected =
    snap.confirmationDialog?.type === 'row' ? snap.confirmationDialog.allRowsSelected : false
  const numRows =
    snap.confirmationDialog?.type === 'row'
      ? snap.confirmationDialog.allRowsSelected
        ? snap.confirmationDialog.numRows ?? 0
        : snap.confirmationDialog.rows.length
      : 0

  const isDeleteWithCascade =
    snap.confirmationDialog?.type === 'column' || snap.confirmationDialog?.type === 'table'
      ? snap.confirmationDialog.isDeleteWithCascade
      : false

  const onConfirmDeleteColumn = async () => {
    if (!(snap.confirmationDialog?.type === 'column')) return

    const selectedColumnToDelete = snap.confirmationDialog.column
    if (selectedColumnToDelete === undefined) return

    deleteColumn({
      id: selectedColumnToDelete.id,
      cascade: isDeleteWithCascade,
      projectRef: projectRef!,
      connectionString: project?.connectionString,
      table: selectedTable,
    })
  }

  const onConfirmDeleteTable = async () => {
    if (!(snap.confirmationDialog?.type === 'table')) return
    const selectedTableToDelete = selectedTable

    if (selectedTableToDelete === undefined) return

    deleteTable({
      projectRef: project?.ref!,
      connectionString: project?.connectionString,
      schema: selectedTableToDelete.schema,
      id: selectedTableToDelete.id,
      cascade: isDeleteWithCascade,
    })
  }

  const getImpersonatedRole = useGetImpersonatedRole()

  const onConfirmDeleteRow = async () => {
    if (!project) return console.error('Project ref is required')
    if (!selectedTable) return console.error('Selected table required')
    if (snap.confirmationDialog?.type !== 'row') return
    const selectedRowsToDelete = snap.confirmationDialog.rows

    if (snap.confirmationDialog.allRowsSelected) {
      if (filters.length === 0) {
        if (getImpersonatedRole() !== undefined) {
          snap.closeConfirmationDialog()
          return toast.error('Table truncation is not supported when impersonating a role')
        }

        truncateRows({
          projectRef: project.ref,
          connectionString: project.connectionString,
          table: selectedTable as any,
        })
      } else {
        deleteAllRows({
          projectRef: project.ref,
          connectionString: project.connectionString,
          table: selectedTable as any,
          filters,
          impersonatedRole: getImpersonatedRole(),
        })
      }
    } else {
      deleteRows({
        projectRef: project.ref,
        connectionString: project.connectionString,
        table: selectedTable as any,
        rows: selectedRowsToDelete as SupaRow[],
        impersonatedRole: getImpersonatedRole(),
      })
    }
  }

  return (
    <>
      <ConfirmationModal
        danger
        size="small"
        visible={snap.confirmationDialog?.type === 'column'}
        header={`Confirm deletion of column "${
          snap.confirmationDialog?.type === 'column' && snap.confirmationDialog.column.name
        }"`}
        buttonLabel="Delete"
        buttonLoadingLabel="Deleting"
        onSelectCancel={() => {
          snap.closeConfirmationDialog()
        }}
        onSelectConfirm={onConfirmDeleteColumn}
      >
        <Modal.Content>
          <div className="py-4 space-y-4">
            <p className="text-sm text-foreground-light">
              Are you sure you want to delete the selected column? This action cannot be undone.
            </p>
            <Checkbox
              label="Drop column with cascade?"
              description="Deletes the column and its dependent objects"
              checked={isDeleteWithCascade}
              onChange={() => snap.toggleConfirmationIsWithCascade()}
            />
            {isDeleteWithCascade && (
              <Alert
                withIcon
                variant="warning"
                title="Warning: Dropping with cascade may result in unintended consequences"
              >
                <p className="mb-4">
                  All dependent objects will be removed, as will any objects that depend on them,
                  recursively.
                </p>
                <Button asChild size="tiny" type="default" icon={<IconExternalLink />}>
                  <Link
                    href="https://www.postgresql.org/docs/current/ddl-depend.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    About dependency tracking
                  </Link>
                </Button>
              </Alert>
            )}
          </div>
        </Modal.Content>
      </ConfirmationModal>

      <ConfirmationModal
        danger
        size="small"
        visible={snap.confirmationDialog?.type === 'table'}
        header={
          <span className="break-words">{`Confirm deletion of table "${selectedTable?.name}"`}</span>
        }
        buttonLabel="Delete"
        buttonLoadingLabel="Deleting"
        onSelectCancel={() => {
          snap.closeConfirmationDialog()
        }}
        onSelectConfirm={onConfirmDeleteTable}
      >
        <Modal.Content>
          <div className="py-4 space-y-4">
            <p className="text-sm text-foreground-light">
              Are you sure you want to delete the selected table? This action cannot be undone.
            </p>
            <Checkbox
              label="Drop table with cascade?"
              description="Deletes the table and its dependent objects"
              checked={isDeleteWithCascade}
              onChange={() => snap.toggleConfirmationIsWithCascade(!isDeleteWithCascade)}
            />
            {isDeleteWithCascade && (
              <Alert
                withIcon
                variant="warning"
                title="Warning: Dropping with cascade may result in unintended consequences"
              >
                <p className="mb-4">
                  All dependent objects will be removed, as will any objects that depend on them,
                  recursively.
                </p>
                <Button asChild size="tiny" type="default" icon={<IconExternalLink />}>
                  <Link
                    href="https://www.postgresql.org/docs/current/ddl-depend.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    About dependency tracking
                  </Link>
                </Button>
              </Alert>
            )}
          </div>
        </Modal.Content>
      </ConfirmationModal>

      <ConfirmationModal
        danger
        size="small"
        visible={snap.confirmationDialog?.type === 'row'}
        header={
          <span className="break-words">
            Confirm to delete the selected row{numRows > 1 && 's'}
          </span>
        }
        buttonLabel="Delete"
        buttonLoadingLabel="Deleting"
        onSelectCancel={() => snap.closeConfirmationDialog()}
        onSelectConfirm={() => onConfirmDeleteRow()}
      >
        <Modal.Content>
          <div className="py-4 space-y-4">
            <p className="text-sm text-foreground-light">
              Are you sure you want to delete {isAllRowsSelected ? 'all' : 'the selected'}{' '}
              {numRows > 1 && `${numRows} `}row
              {numRows > 1 && 's'}? This action cannot be undone.
            </p>
          </div>
        </Modal.Content>
      </ConfirmationModal>
    </>
  )
}

export default DeleteConfirmationDialogs
