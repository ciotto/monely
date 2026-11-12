from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.models import User, Wallet


def check_password(password, **user_fields):
    """Runs the Django password validators, raising the errors on the `password` field."""
    try:
        validate_password(password, User(**user_fields))
    except DjangoValidationError as e:
        raise serializers.ValidationError({"password": list(e.messages)})


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "is_staff")


class OwnerSerializer(serializers.ModelSerializer):
    """The users that can own a wallet, visible to everyone."""

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name")


class WalletSerializer(serializers.ModelSerializer):
    owners = serializers.PrimaryKeyRelatedField(many=True, allow_empty=False, queryset=User.objects.all())

    class Meta:
        model = Wallet
        fields = ("id", "name", "currency", "owners", "is_archived", "created_at")
        read_only_fields = ("created_at",)

    def get_fields(self):
        fields = super().get_fields()
        # Amounts are never converted, so the currency is fixed once the wallet exists
        if self.instance is not None:
            fields["currency"].read_only = True
        return fields


class AdminUserSerializer(serializers.ModelSerializer):
    """Manages the other users; `is_staff` marks the admins, which are also superusers for the Django admin."""

    password = serializers.CharField(trim_whitespace=False, write_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "is_staff",
            "is_active",
            "date_joined",
            "last_login",
            "password",
        )
        read_only_fields = ("date_joined", "last_login")

    def get_fields(self):
        fields = super().get_fields()
        # When editing, a missing password keeps the current one
        fields["password"].required = self.instance is None
        return fields

    def validate(self, attrs):
        # Admins cannot lock themselves out: this also keeps at least one active admin
        if self.instance is not None and self.instance == self.context["request"].user:
            errors = {
                field: _("You cannot change this on your own account.")
                for field in ("is_staff", "is_active")
                if field in attrs and attrs[field] != getattr(self.instance, field)
            }
            if errors:
                raise serializers.ValidationError(errors)
        if "password" in attrs:
            check_password(
                attrs["password"],
                **{
                    field: attrs.get(field, getattr(self.instance, field, ""))
                    for field in ("email", "first_name", "last_name")
                },
            )
        return attrs

    def create(self, validated_data):
        validated_data["is_superuser"] = validated_data.get("is_staff", False)
        return User.objects.create_user(**validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        if password is not None:
            instance.set_password(password)
        if "is_staff" in validated_data:
            validated_data["is_superuser"] = validated_data["is_staff"]
        return super().update(instance, validated_data)


class SetupSerializer(serializers.ModelSerializer):
    password = serializers.CharField(trim_whitespace=False, write_only=True)

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "password")

    def validate(self, attrs):
        check_password(**attrs)
        return attrs

    def create(self, validated_data):
        # The first user manages the instance, so it can also use the Django admin
        return User.objects.create_superuser(**validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)

    def validate(self, attrs):
        user = authenticate(self.context["request"], email=attrs["email"], password=attrs["password"])
        if user is None:
            raise serializers.ValidationError(_("Invalid email or password."), code="authorization")
        attrs["user"] = user
        return attrs
