from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    HttpUrl,
    model_validator,
)


def _trim(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must include an explicit UTC offset")
    return value.astimezone(UTC)


Text = Annotated[str, BeforeValidator(_trim)]
Timestamp = Annotated[datetime, AfterValidator(_aware)]
EventStatus = Literal["scheduled", "completed", "cancelled"]
HandoffStatus = Literal["pending", "answered", "delivered", "cancelled"]
CommunicationActionType = Literal[
    "SMS_REQUESTED",
    "CALL_REQUESTED",
    "CAREGIVER_ASSISTANCE",
    "URGENT_HELP_REQUESTED",
]
CommunicationActionStatus = Literal["PROPOSED", "CONFIRMED", "SIMULATED", "CANCELLED"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonFields(StrictModel):
    name: Text = Field(min_length=1, max_length=120)
    relationship: Text = Field(min_length=1, max_length=120)
    description: Text = Field(max_length=2000)
    photo_url: Text | None = None
    contact_approved: bool = False

    @model_validator(mode="after")
    def validate_photo_url(self) -> "PersonFields":
        if self.photo_url is not None and not self.photo_url.startswith("/"):
            HttpUrl(self.photo_url)
        return self


class PersonCreate(PersonFields):
    pass


class PersonUpdate(StrictModel):
    name: Text | None = Field(default=None, min_length=1, max_length=120)
    relationship: Text | None = Field(default=None, min_length=1, max_length=120)
    description: Text | None = Field(default=None, max_length=2000)
    photo_url: Text | None = None
    contact_approved: bool | None = None

    @model_validator(mode="after")
    def validate_update(self) -> "PersonUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if (
            "photo_url" in self.model_fields_set
            and self.photo_url is not None
            and not self.photo_url.startswith("/")
        ):
            HttpUrl(self.photo_url)
        for field in ("name", "relationship", "description", "contact_approved"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Person(PersonFields):
    id: int


class MemoryFields(StrictModel):
    person_id: int | None = Field(default=None, gt=0)
    title: Text = Field(min_length=1, max_length=120)
    content: Text = Field(min_length=1, max_length=4000)
    category: Text = Field(min_length=1, max_length=120)


class MemoryCreate(MemoryFields):
    pass


class MemoryUpdate(StrictModel):
    person_id: int | None = Field(default=None, gt=0)
    title: Text | None = Field(default=None, min_length=1, max_length=120)
    content: Text | None = Field(default=None, min_length=1, max_length=4000)
    category: Text | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_update(self) -> "MemoryUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for field in ("title", "content", "category"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Memory(MemoryFields):
    id: int
    created_at: str


class EventFields(StrictModel):
    title: Text = Field(min_length=1, max_length=120)
    description: Text = Field(max_length=2000)
    start_time: Timestamp
    person_id: int | None = Field(default=None, gt=0)
    reminder_minutes: int = Field(ge=0, le=10080)
    status: EventStatus


class EventCreate(EventFields):
    pass


class EventUpdate(StrictModel):
    title: Text | None = Field(default=None, min_length=1, max_length=120)
    description: Text | None = Field(default=None, max_length=2000)
    start_time: Timestamp | None = None
    person_id: int | None = Field(default=None, gt=0)
    reminder_minutes: int | None = Field(default=None, ge=0, le=10080)
    status: EventStatus | None = None

    @model_validator(mode="after")
    def validate_update(self) -> "EventUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for field in (
            "title",
            "description",
            "start_time",
            "reminder_minutes",
            "status",
        ):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Event(StrictModel):
    id: int
    title: str
    description: str
    start_time: str
    person_id: int | None
    reminder_minutes: int
    status: EventStatus


class ConversationMessage(StrictModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: str


class Handoff(StrictModel):
    id: int
    caregiver_person_id: int
    question: str
    status: HandoffStatus
    response: str | None
    created_at: str
    answered_at: str | None
    delivered_at: str | None


class HandoffCreate(StrictModel):
    caregiver_person_id: int = Field(gt=0)
    question: Text = Field(min_length=1, max_length=2000)
    consent_confirmed: Literal[True]


class HandoffAnswer(StrictModel):
    response: Text = Field(min_length=1, max_length=2000)


class ChatRequest(StrictModel):
    message: Text = Field(min_length=1, max_length=2000)


class SpeechRequest(StrictModel):
    text: Text = Field(min_length=1, max_length=4096)


class CompanionSettings(StrictModel):
    timezone: Text = Field(min_length=1, max_length=120)
    quiet_hours_start: str | None
    quiet_hours_end: str | None


class CompanionSettingsUpdate(StrictModel):
    timezone: Text = Field(min_length=1, max_length=120)
    quiet_hours_start: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    quiet_hours_end: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    @model_validator(mode="after")
    def validate_quiet_hours(self) -> "CompanionSettingsUpdate":
        if (self.quiet_hours_start is None) != (self.quiet_hours_end is None):
            raise ValueError("quiet hours start and end must both be set or both be null")
        if self.quiet_hours_start == self.quiet_hours_end and self.quiet_hours_start is not None:
            raise ValueError("quiet hours start and end must differ")
        return self


class CheckInFields(StrictModel):
    title: Text = Field(min_length=1, max_length=120)
    prompt: Text = Field(min_length=1, max_length=2000)
    time_of_day: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    enabled: bool = True


class CheckInCreate(CheckInFields):
    pass


class CheckInUpdate(StrictModel):
    title: Text | None = Field(default=None, min_length=1, max_length=120)
    prompt: Text | None = Field(default=None, min_length=1, max_length=2000)
    time_of_day: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    enabled: bool | None = None

    @model_validator(mode="after")
    def validate_update(self) -> "CheckInUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("check-in fields cannot be null")
        return self


class CheckIn(CheckInFields):
    id: int
    created_at: str


class ReminderNotification(StrictModel):
    id: int
    kind: Literal["event", "check_in", "demo"]
    event_id: int | None
    check_in_id: int | None
    title: str
    message: str
    due_at: str
    expires_at: str
    status: Literal["pending", "delivered", "acknowledged"]
    created_at: str
    delivered_at: str | None
    acknowledged_at: str | None


class DemoReminderCreate(StrictModel):
    kind: Literal["check_in", "appointment"]
    title: Text | None = Field(default=None, min_length=1, max_length=120)
    message: Text | None = Field(default=None, min_length=1, max_length=2000)


class DailyBriefing(StrictModel):
    date: str
    timezone: str
    upcoming_appointments: list[Event]
    expected_visitors: list[Event]
    scheduled_routines: list[Memory]
    relevant_reminders: list[ReminderNotification]
    preferences: list[Memory]


class CommunicationAction(StrictModel):
    id: int
    action_type: CommunicationActionType
    recipient_person_id: int | None
    reason: str
    proposed_content: str | None
    status: CommunicationActionStatus
    confirmation_status: Literal["PENDING", "CONFIRMED", "CANCELLED"]
    execution_status: Literal["NOT_EXECUTED", "SIMULATED"]
    source_conversation_message_id: int | None
    is_demo: bool
    created_at: str
    confirmed_at: str | None
    simulated_at: str | None
    cancelled_at: str | None


class CommunicationActionCreate(StrictModel):
    action_type: CommunicationActionType
    recipient_person_id: int | None = Field(default=None, gt=0)
    reason: Text = Field(min_length=1, max_length=2000)
    proposed_content: Text | None = Field(default=None, min_length=1, max_length=2000)
    source_conversation_message_id: int | None = Field(default=None, gt=0)


class DemoCommunicationActionCreate(StrictModel):
    action_type: CommunicationActionType
    recipient_person_id: int | None = Field(default=None, gt=0)
    reason: Text = Field(min_length=1, max_length=2000)
    proposed_content: Text | None = Field(default=None, min_length=1, max_length=2000)
    simulated: Literal[True]


class Source(StrictModel):
    type: Literal["person", "memory", "event", "handoff"]
    id: int


class ChatResponse(StrictModel):
    message: ConversationMessage
    grounded: bool
    sources: list[Source]
    handoff_offered: bool
    action: CommunicationAction | None = None


class ConversationContext(StrictModel):
    messages: list[ConversationMessage]
    people: list[Person]
    memories: list[Memory]
    upcoming_events: list[Event]
    pending_handoffs: list[Handoff]
