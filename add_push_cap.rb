require 'xcodeproj'

project_path = 'ios/AASTryout.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Find the target
target = project.targets.first

# 1. Add entitlements file reference to the group if not exists
group = project.main_group.groups.find { |g| g.name == 'AASTryout' } || project.main_group.children.find { |c| c.name == 'AASTryout' }
file_ref = group.files.find { |f| f.path == 'AASTryout.entitlements' }
if file_ref.nil?
  file_ref = group.new_file('AASTryout.entitlements')
end

# 2. Update Build Settings to include the entitlements file
target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'AASTryout/AASTryout.entitlements'
end

# 3. Add Push Notification capability attribute
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][target.uuid] ||= {}
project.root_object.attributes['TargetAttributes'][target.uuid]['SystemCapabilities'] ||= {}
project.root_object.attributes['TargetAttributes'][target.uuid]['SystemCapabilities']['com.apple.Push'] = { 'enabled' => '1' }
project.root_object.attributes['TargetAttributes'][target.uuid]['SystemCapabilities']['com.apple.BackgroundModes'] = { 'enabled' => '1' }

project.save
puts "Successfully updated project.pbxproj with push capabilities"
