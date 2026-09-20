from collections import defaultdict

class AllNames:
    def __contains__(self, name):
        return True

class AllBindings(defaultdict):
    def __contains__(self, name):
        return True

white_list = AllBindings(AllNames)
white_list[''] = AllNames()
