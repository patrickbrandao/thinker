output "service_url" {
  description = "Thinker Cloud Run URL."
  value       = google_cloud_run_v2_service.thinker.uri
}

output "health_check_url" {
  description = "Thinker health check URL."
  value       = "${google_cloud_run_v2_service.thinker.uri}/api/v1/health"
}

output "database_instance" {
  description = "Cloud SQL instance name."
  value       = google_sql_database_instance.thinker.name
}

output "database_url_secret" {
  description = "Secret Manager secret containing DATABASE_URL."
  value       = google_secret_manager_secret.managed["database_url"].id
}

output "recording_bucket" {
  description = "Private Cloud Storage bucket mounted for request recordings."
  value       = google_storage_bucket.recordings.name
}
