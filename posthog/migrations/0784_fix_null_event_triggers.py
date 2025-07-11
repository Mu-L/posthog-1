# Generated by Django 4.2.22 on 2025-07-01 10:37

from django.db import migrations


def forwards(apps, schema_editor):
    team_model = apps.get_model("posthog", "Team")

    # this is a relatively small number of teams, so we don't need to worry about batching
    for team in team_model.objects.exclude(session_recording_event_trigger_config=None):
        config = team.session_recording_event_trigger_config
        if config is None:
            continue
        cleaned = [v for v in config if v is not None]
        if cleaned != config:
            team.session_recording_event_trigger_config = cleaned
            # don't want to save these in bulk since there aren't many,
            # and we want signals to run and update the team cache
            team.save(update_fields=["session_recording_event_trigger_config"])


def backwards(apps, schema_editor):
    # This migration cannot be reversed we don't need the null values
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("posthog", "0783_remove_segment_engage_destinations"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
