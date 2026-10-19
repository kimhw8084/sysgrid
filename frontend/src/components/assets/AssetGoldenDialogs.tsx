import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Database, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { AssetDetailsView } from './AssetDetailsView'
import AssetGoldenQuickLookPanel from './AssetGoldenQuickLookPanel'
import { AssetRecordFormModal, NetworkConnectionForm } from '../AssetReal'
import { OperationalImportModal } from '../shared/OperationalImportModal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { WorkspaceDossierShell } from '../shared/WorkspaceModalShells'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { ConfigRegistryModal } from '../ConfigRegistry'
import { ServiceDetailsView, ServiceForm } from '../ServiceRegistry'
import { apiFetch } from '../../api/apiClient'
import { withServiceEditRevision } from '../../utils/serviceRevision'
import { parseOperationalApiValidationError } from '../shared/OperationalFieldValidation'

function AssetDetailsDialog({ detailAsset, onCloseDetails, options, setServiceDetails, setServiceEdit, onCloseLinkEdit, onCloseLinkDetails }: any) {
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftPending, setDraftPending] = useState(false)
  return <WorkspaceModal isOpen onClose={() => {
    if (draftPending) { toast('Wait for the current save to finish.'); return }
    onCloseDetails()
  }} size="workspace" title={detailAsset.name} subtitle={`${detailAsset.system} · ${detailAsset.type}`} isDirty={draftDirty && !draftPending}
    dirtyConfirmMessage="Discard the unsaved hardware, credential, or relationship drafts for this asset?"
    footerLeft={draftPending ? <span role="status">Saving asset changes...</span> : undefined}>
    <div className="pt-6"><AssetDetailsView device={detailAsset} options={options} onViewServiceDetails={setServiceDetails} onEditService={setServiceEdit}
      onEditLink={onCloseLinkEdit} onViewLink={onCloseLinkDetails} onDraftDirtyChange={setDraftDirty} onDraftPendingChange={setDraftPending} /></div>
  </WorkspaceModal>
}

function AssetServiceDialogs({
  activeDetails,
  activeEdit,
  devices,
  onCloseDetails,
  onCloseEdit,
  onRefresh,
  options,
}: any) {
  const queryClient = useQueryClient()
  const [serviceSaveError, setServiceSaveError] = useState('')
  const [serviceDraftDirty, setServiceDraftDirty] = useState(false)
  useEffect(() => {
    setServiceSaveError('')
    setServiceDraftDirty(false)
  }, [activeEdit?.id])
  const mutation = useMutation({
    meta: { handlesErrorToast: true },
    mutationFn: async (payload: any) => {
      const response = await apiFetch(`/api/v1/logical-services/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify(withServiceEditRevision(payload, payload)),
      })
      if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status })
      return response.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logical-services'] })
      toast.success('Service updated')
      onRefresh()
      onCloseEdit()
    },
    onError: (error: any) => {
      const message = parseOperationalApiValidationError(error).generalError || 'Service update failed'
      setServiceSaveError(message)
      toast.error(error.status === 409 ? 'Service changed; your draft is preserved.' : message)
    },
  })

  return (
    <>
      <WorkspaceModal
        isOpen={Boolean(activeDetails)}
        onClose={onCloseDetails}
        size="workspace"
        title={activeDetails?.name || 'Service Details'}
        subtitle={activeDetails ? `${activeDetails.service_type} · ${activeDetails.environment}` : ''}
        icon={<Eye size={18} />}
        footerRight={<ToolbarButton onClick={onCloseDetails}>Close</ToolbarButton>}
      >
        {activeDetails ? <div className="pt-6"><ServiceDetailsView service={activeDetails} options={options} devices={devices} /></div> : null}
      </WorkspaceModal>

      <WorkspaceModal
        isOpen={Boolean(activeEdit)}
        onClose={() => {
          if (mutation.isPending) { toast('Wait for the current save to finish.'); return }
          onCloseEdit()
        }}
        size="workspace"
        title="Edit Service"
        subtitle={activeEdit ? `Service ID ${activeEdit.id} · ${activeEdit.device_name || 'Floating host'}` : ''}
        icon={<Database size={20} />}
        isDirty={serviceDraftDirty && !mutation.isPending}
        dirtyConfirmTitle="Discard Service Changes?"
        dirtyConfirmMessage="You have unsaved service changes. Close this window and discard them?"
        footerRight={<ToolbarButton variant="primary" disabled={mutation.isPending}
          onClick={() => (document.getElementById('asset-service-record-form') as HTMLFormElement | null)?.requestSubmit()}>
          Save Service
        </ToolbarButton>}
      >
        {activeEdit ? (
          <WorkspaceDossierShell body={<ServiceForm
              key={activeEdit.id}
              formId="asset-service-record-form"
              initialData={activeEdit}
              onSave={mutation.mutate}
              isPending={mutation.isPending}
              backendGeneralError={serviceSaveError}
              onDirtyChange={setServiceDraftDirty}
              renderActions={false}
              options={options}
              devices={devices}
            />} />
        ) : null}
      </WorkspaceModal>
    </>
  )
}

export function AssetGoldenDialogs({
  detailAsset,
  detailLink,
  devices,
  editingAsset,
  editingLink,
  linkPurposeOptions,
  farmOptions,
  cableTypeOptions,
  onCloseDetails,
  onCloseEdit,
  onCloseLinkDetails,
  onCloseLinkEdit,
  onRefresh,
  options,
  quickLookAsset,
  setEditingAsset,
  setQuickLookAsset,
  setServiceDetails,
  setServiceEdit,
  showImportModal,
  showRegistryModal,
  serviceDetails,
  serviceEdit,
  setShowImportModal,
  setShowRegistryModal,
  confirmState,
  setConfirmState,
}: any) {
  return (
    <>
      {quickLookAsset ? (
        <AssetGoldenQuickLookPanel
          asset={quickLookAsset}
          onClose={() => setQuickLookAsset(null)}
          onEdit={(asset) => {
            setQuickLookAsset(null)
            setEditingAsset(asset)
          }}
        />
      ) : null}

      {detailAsset ? (
        <AssetDetailsDialog key={detailAsset.id} detailAsset={detailAsset} onCloseDetails={onCloseDetails} options={options}
          setServiceDetails={setServiceDetails} setServiceEdit={setServiceEdit} onCloseLinkEdit={onCloseLinkEdit} onCloseLinkDetails={onCloseLinkDetails} />
      ) : null}

      {editingAsset ? <AssetRecordFormModal item={editingAsset} onClose={onCloseEdit} onSuccess={() => { onCloseEdit(); onRefresh() }} /> : null}
      {editingLink ? (
        <NetworkConnectionForm
          item={editingLink}
          devices={devices}
          onClose={onCloseLinkEdit}
          onSuccess={onRefresh}
          linkPurposeOptions={linkPurposeOptions}
          farmOptions={farmOptions}
          cableTypeOptions={cableTypeOptions}
        />
      ) : null}
      {detailLink ? (
        <NetworkConnectionForm
          item={detailLink}
          devices={devices}
          onClose={onCloseLinkDetails}
          onSuccess={onRefresh}
          linkPurposeOptions={linkPurposeOptions}
          farmOptions={farmOptions}
          cableTypeOptions={cableTypeOptions}
        />
      ) : null}

      <AssetServiceDialogs
        activeDetails={serviceDetails}
        activeEdit={serviceEdit}
        devices={devices}
        onCloseDetails={() => setServiceDetails(null)}
        onCloseEdit={() => setServiceEdit(null)}
        onRefresh={onRefresh}
        options={options}
      />

      <OperationalImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        tableName="devices"
        displayName="Assets"
      />

      <ConfigRegistryModal
        isOpen={showRegistryModal}
        onClose={() => setShowRegistryModal(false)}
        title="Asset Registry Enumerations"
        sections={[
          { title: 'Asset Types', category: 'DeviceType', icon: Eye },
          { title: 'Logical Systems', category: 'LogicalSystem', icon: Eye },
          { title: 'Business Units', category: 'BusinessUnit', icon: Eye },
        ]}
      />

      <ConfirmationModal
        isOpen={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          confirmState?.onConfirm()
          setConfirmState(null)
        }}
        title={confirmState?.title || 'Confirm'}
        message={confirmState?.message || ''}
      />
    </>
  )
}
