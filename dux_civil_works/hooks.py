app_name = "dux_civil_works"
app_title = "Dux Civil Works"
app_publisher = "Dutch Digitech"
app_description = "Civil works contract management — Work Orders, BOQ, RA Bills, integrated with ERPNext"
app_email = "aditya.surana@duxdigitech.in"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "dux_civil_works",
# 		"logo": "/assets/dux_civil_works/logo.png",
# 		"title": "Dux Civil Works",
# 		"route": "/dux_civil_works",
# 		"has_permission": "dux_civil_works.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/dux_civil_works/css/dux_civil_works.css"
# app_include_js = "/assets/dux_civil_works/js/dux_civil_works.js"

# include js, css files in header of web template
# web_include_css = "/assets/dux_civil_works/css/dux_civil_works.css"
# web_include_js = "/assets/dux_civil_works/js/dux_civil_works.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "dux_civil_works/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "dux_civil_works/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "dux_civil_works.utils.jinja_methods",
# 	"filters": "dux_civil_works.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "dux_civil_works.install.before_install"
# after_install = "dux_civil_works.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "dux_civil_works.uninstall.before_uninstall"
# after_uninstall = "dux_civil_works.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "dux_civil_works.utils.before_app_install"
# after_app_install = "dux_civil_works.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "dux_civil_works.utils.before_app_uninstall"
# after_app_uninstall = "dux_civil_works.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "dux_civil_works.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"dux_civil_works.tasks.all"
# 	],
# 	"daily": [
# 		"dux_civil_works.tasks.daily"
# 	],
# 	"hourly": [
# 		"dux_civil_works.tasks.hourly"
# 	],
# 	"weekly": [
# 		"dux_civil_works.tasks.weekly"
# 	],
# 	"monthly": [
# 		"dux_civil_works.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "dux_civil_works.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "dux_civil_works.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "dux_civil_works.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "dux_civil_works.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["dux_civil_works.utils.before_request"]
# after_request = ["dux_civil_works.utils.after_request"]

# Job Events
# ----------
# before_job = ["dux_civil_works.utils.before_job"]
# after_job = ["dux_civil_works.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"dux_civil_works.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []



# ============================================================
# Pre-Step 6a: app-shipped master data fixtures
# Loaded in this order on every `bench migrate`:
#   1. UOM (12 records) - referenced by Items via stock_uom
#   2. Item Group (1 record: "Work Order Items") - referenced by Items via item_group
#   3. Item (12 service items) - all in Work Order Items group
# ============================================================

fixtures = [
    {
        "doctype": "UOM",
        "filters": [
            ["name", "in", [
                "Nos", "Lump Sum", "Cubic Meter", "Square Meter", "Meter",
                "Kilometer", "Quintal", "Tonne", "Brass", "Kg", "Litre", "Day",
            ]]
        ],
    },
    {
        "doctype": "Item Group",
        "filters": [["name", "=", "Work Order Items"]],
    },
    {
        "doctype": "Item",
        "filters": [["item_group", "=", "Work Order Items"]],
    },
]


# ============================================================
# Step 6: Purchase Invoice <-> Work Order RA Bill integration
# ============================================================

# Bundle the JS to load on Purchase Invoice form
doctype_js = {
    "Purchase Invoice": "public/js/purchase_invoice.js",
}

# Server-side hooks for Purchase Invoice <-> Work Order RA Bill linkage
doc_events = {
    "Purchase Invoice": {
        "validate": "dux_civil_works.dux_civil_works.api.purchase_invoice_hooks.pi_validate",
        "on_submit": "dux_civil_works.dux_civil_works.api.purchase_invoice_hooks.pi_on_submit",
        "on_cancel": "dux_civil_works.dux_civil_works.api.purchase_invoice_hooks.pi_on_cancel",
    },
}
