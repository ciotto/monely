from django.contrib.auth import authenticate
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from core.models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name")


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)

    def validate(self, attrs):
        user = authenticate(self.context["request"], email=attrs["email"], password=attrs["password"])
        if user is None:
            raise serializers.ValidationError(_("Invalid email or password."), code="authorization")
        attrs["user"] = user
        return attrs
