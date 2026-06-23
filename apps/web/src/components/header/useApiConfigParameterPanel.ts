import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomApiConfig, OfficialCapabilityUrlProbe } from '../../types';
import { fetchModelCapabilities, probeOfficialCapabilityUrl } from '../../lib/db';
import type { ModelMetadata, ProbeStatus, RegistryEntry } from './apiConfigParameterUtils';
import { useApiConfigRegistryActions } from './useApiConfigRegistryActions';
import { useApiConfigRuntimeAdapter } from './useApiConfigRuntimeAdapter';

type Props = {
  config: CustomApiConfig;
  probeStatus: ProbeStatus;
  onConfigApplied?: (config: CustomApiConfig, options?: { persist?: boolean }) => void;
};

export function useApiConfigParameterPanel({
  config,
  probeStatus,
  onConfigApplied
}: Props) {
  const [officialUrl, setOfficialUrl] = useState('');
  const [officialProbe, setOfficialProbe] = useState<OfficialCapabilityUrlProbe | null>(null);
  const [officialProbeError, setOfficialProbeError] = useState<string | null>(null);

  const isTextConfig = config.type === 'text';
  const capability = (config.capability || (
    config.type === 'image'
      ? 'IMAGE_GENERATOR'
      : config.type === 'video'
        ? 'VIDEO_GENERATOR'
        : 'TEXT_GENERATOR'
  )) as RegistryEntry['capability'];

  const { data: capabilities = [] } = useQuery({
    queryKey: ['model-capabilities', capability],
    queryFn: () => fetchModelCapabilities(capability),
    enabled: !isTextConfig,
    staleTime: 60_000
  });

  const fetchedCapabilityProfile = config.canonicalModelId
    ? capabilities.find((item) => item.canonicalModelId === config.canonicalModelId)
    : undefined;
  const capabilityProfile = config.capabilityProfile?.canonicalModelId === config.canonicalModelId
    ? config.capabilityProfile
    : fetchedCapabilityProfile;

  const activeParams = capabilityProfile?.activeRevision?.params || {};
  const trustedParams = config.type === 'image'
    ? activeParams.imageCapabilities
    : config.type === 'video'
      ? activeParams.videoCapabilities
      : activeParams.textCapabilities;

  const registry = useApiConfigRegistryActions({
    config,
    capability,
    capabilityProfile,
    onConfigApplied
  });

  const runtime = useApiConfigRuntimeAdapter({
    config,
    capability,
    capabilityProfile,
    activeParams,
    onConfigApplied
  });

  const urlProbeMutation = useMutation({
    mutationFn: () => probeOfficialCapabilityUrl({
      url: officialUrl,
      canonicalModelId: config.canonicalModelId,
      capability
    }),
    onMutate: () => {
      setOfficialProbe(null);
      setOfficialProbeError(null);
    },
    onSuccess: (result) => setOfficialProbe(result),
    onError: (error: any) => setOfficialProbeError(error?.message || '官方链接探测失败')
  });

  const metadata = config.metadata as ModelMetadata | undefined;
  const executable = Boolean(capabilityProfile?.executable);
  const statusText = capabilityProfile?.verificationStatus || 'UNKNOWN';
  const hasTrustedTemplate = Boolean(trustedParams);
  const maxImages = trustedParams?.limits?.maxInputImages ?? metadata?.maxImages ?? 4;
  const effectiveProbeStatus = config.canonicalModelId && capabilityProfile ? 'success' : probeStatus;

  return {
    isTextConfig,
    capabilityProfile,
    officialUrl,
    setOfficialUrl,
    officialProbe,
    officialProbeError,
    metadata,
    executable,
    statusText,
    hasTrustedTemplate,
    maxImages,
    effectiveProbeStatus,
    urlProbeMutation,
    ...registry,
    ...runtime
  };
}
