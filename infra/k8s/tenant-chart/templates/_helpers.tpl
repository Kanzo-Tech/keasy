{{/* Workspace resource name prefix — mirrors the Swarm "keasy-ws-<slug>" convention. */}}
{{- define "keasy-tenant.name" -}}
keasy-ws-{{ required "slug is required" .Values.slug }}
{{- end -}}

{{- define "keasy-tenant.host" -}}
{{ required "slug is required" .Values.slug }}.{{ required "baseDomain is required" .Values.baseDomain }}
{{- end -}}

{{- define "keasy-tenant.secretName" -}}
{{- default (printf "keasy-ws-%s" .Values.slug) .Values.secretName -}}
{{- end -}}

{{- define "keasy-tenant.serverImage" -}}
{{- if .Values.image.server -}}{{ .Values.image.server }}{{- else -}}{{ .Values.image.repoPrefix }}-server:{{ .Values.image.tag }}{{- end -}}
{{- end -}}

{{- define "keasy-tenant.webImage" -}}
{{- if .Values.image.web -}}{{ .Values.image.web }}{{- else -}}{{ .Values.image.repoPrefix }}-web:{{ .Values.image.tag }}{{- end -}}
{{- end -}}

{{- define "keasy-tenant.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: keasy
com.keasy.workspace: {{ include "keasy-tenant.name" . }}
{{- end -}}
